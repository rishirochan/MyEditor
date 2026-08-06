import { db } from "@/lib/db";
import { projectFiles } from "@/lib/db/schema";
import { resolveProjectAccess } from "@/lib/auth/project-access";
import * as storage from "@/lib/storage";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

function buildDownloadPdfName(projectName: string): string {
  const safeProjectName =
    projectName
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
  const unixEpoch = Math.floor(Date.now() / 1000);
  return `${safeProjectName}-${unixEpoch}.pdf`;
}

// ─── GET /api/projects/[projectId]/pdf ─────────────
// Serve the compiled PDF for a project.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    const access = await resolveProjectAccess(request, projectId);
    if (!access.access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const project = access.project;
    const mainFile = request.nextUrl.searchParams.get("mainFile") ?? project.mainFile;

    const [document] = await db
      .select({ id: projectFiles.id })
      .from(projectFiles)
      .where(
        and(
          eq(projectFiles.projectId, projectId),
          eq(projectFiles.path, mainFile),
          eq(projectFiles.isDocument, true)
        )
      )
      .limit(1);

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Resolve the PDF path on disk (use project owner's directory)
    const pdfPath = storage.getPdfPath(project.userId, projectId, mainFile);
    const exists = await storage.fileExists(pdfPath);

    if (!exists) {
      return NextResponse.json(
        { error: "PDF not found. Please compile the project first." },
        { status: 404 }
      );
    }

    const pdfBuffer = await storage.readFileBinary(pdfPath);
    const pdfName = mainFile.replace(/\.tex$/, ".pdf");
    const downloadPdfName = buildDownloadPdfName(project.name);

    // Support ?download=true for Content-Disposition: attachment
    const download = request.nextUrl.searchParams.get("download") === "true";

    const headers: Record<string, string> = {
      "Content-Type": "application/pdf",
      "Content-Length": pdfBuffer.length.toString(),
    };

    if (download) {
      headers["Content-Disposition"] =
        `attachment; filename="${downloadPdfName}"`;
    } else {
      headers["Content-Disposition"] =
        `inline; filename="${pdfName}"`;
    }

    return new NextResponse(new Uint8Array(pdfBuffer), { status: 200, headers });
  } catch (error) {
    console.error("Error serving PDF:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
