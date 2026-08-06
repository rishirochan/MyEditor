import { withAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { projectFiles } from "@/lib/db/schema";
import { checkProjectAccess } from "@/lib/db/queries/projects";
import { completeStrictJson } from "@/lib/ai/client";
import { getUserAiSettings } from "@/lib/ai/settings";
import { PROFILE_SNAPSHOT_FILE } from "@/lib/ai/linkedin";
import { linkedinResponseSchema } from "@/lib/ai/linkedinSchema";
import * as storage from "@/lib/storage";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import path from "path";

const requestSchema = z.object({
  projectId: z.string().uuid(),
  resumePath: z.string().trim().min(1).max(1000),
  resumeContent: z.string().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000),
      })
    )
    .min(1)
    .max(30),
});

function normalizeFilePath(value: string): string {
  return value.trim().replace(/^\.\//, "");
}

const systemPrompt = [
  "You turn a LaTeX resume into text the member can paste into LinkedIn profile fields.",
  "Return ONLY valid JSON matching this exact schema:",
  '{ reply: string, updates: [{ section: "headline"|"about"|"experience"|"education"|"skills"|"projects", label: string, current: string, proposed: string }] }',
  "Rules:",
  "1) proposed must be plain text ready to paste. Strip ALL LaTeX: expand macros, drop \\textbf/\\emph/\\item/math mode, unescape \\% \\& \\_ \\#, convert ~ to a space.",
  "2) No markdown. No asterisks for bold. LinkedIn renders none of it.",
  "3) label identifies the field to a human, e.g. \"Experience — Acme Corp (Senior Engineer)\".",
  "4) current is the matching text from the profile snapshot, or \"\" when the snapshot has no counterpart or was not provided.",
  "5) Only emit an update when proposed differs meaningfully from current. Ignore pure formatting noise.",
  "6) Write in first person for headline and about. Keep experience bullets in resume voice (strong verb, quantified result).",
  "7) Target lengths: headline under 220 characters, about under 2600, each experience entry under 2000. Stay well inside these.",
  "8) For skills, emit one update whose proposed is a comma-separated list.",
  "9) updates may be empty when the user only asks a question. reply is a short conversational answer.",
  "10) Never invent employers, dates, titles, metrics, or degrees that are absent from the resume.",
  "11) Do not include markdown or extra keys.",
].join("\n");

export async function POST(request: NextRequest) {
  return withAuth(request, async (req, user) => {
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { projectId, messages } = parsed.data;

    const access = await checkProjectAccess(user.id, projectId);
    if (!access.access) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const aiSettings = await getUserAiSettings(user.id);
    if (!aiSettings.enabled) {
      return NextResponse.json(
        { error: "AI features are disabled for this account" },
        { status: 403 }
      );
    }

    const project = access.project;
    const projectDir = storage.getProjectDir(project.userId, projectId);

    const files = await db
      .select({
        path: projectFiles.path,
        isDirectory: projectFiles.isDirectory,
      })
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));

    const readableFiles = files.filter((file) => !file.isDirectory);

    const resumePath = normalizeFilePath(parsed.data.resumePath);
    const resumeFile = readableFiles.find((file) => file.path === resumePath);
    if (!resumeFile) {
      return NextResponse.json(
        { error: "Resume file not found in project" },
        { status: 400 }
      );
    }

    // The editor buffer is newer than disk while the user is typing.
    const resumeContent =
      typeof parsed.data.resumeContent === "string"
        ? parsed.data.resumeContent
        : await storage
            .readFile(path.join(projectDir, resumeFile.path))
            .catch(() => "");

    // ponytail: the current-profile snapshot is just a file in the project, so
    // it needs no table, no migration, and no LinkedIn read access (there is no
    // public API for one). Absent snapshot simply means every update is new.
    const snapshotFile = readableFiles.find(
      (file) => file.path === PROFILE_SNAPSHOT_FILE
    );
    const profileSnapshot = snapshotFile
      ? await storage
          .readFile(path.join(projectDir, snapshotFile.path))
          .catch(() => "")
      : "";

    const userPrompt = JSON.stringify(
      {
        resume: {
          path: resumeFile.path,
          latex: resumeContent.slice(0, 32_000),
        },
        profileSnapshot: profileSnapshot.slice(0, 16_000),
        hasProfileSnapshot: profileSnapshot.trim().length > 0,
        conversation: messages,
      },
      null,
      2
    );

    let aiPayload: unknown;
    try {
      aiPayload = await completeStrictJson({
        modelSettings: aiSettings.latexWriter,
        systemPrompt,
        userPrompt,
        temperature: 0.2,
        maxTokens: 4_000,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "AI provider request failed",
        },
        { status: 502 }
      );
    }

    const aiResult = linkedinResponseSchema.safeParse(aiPayload);
    if (!aiResult.success) {
      return NextResponse.json(
        {
          error: "AI response schema validation failed",
          details: aiResult.error.flatten().fieldErrors,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      reply: aiResult.data.reply,
      updates: aiResult.data.updates,
      hasProfileSnapshot: profileSnapshot.trim().length > 0,
      snapshotFile: PROFILE_SNAPSHOT_FILE,
    });
  });
}
