import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "MyEditor",
  description: "Open-source LaTeX editor with live PDF preview",
  icons: {
    icon: "/icon.svg",
  },
  openGraph: {
    title: "MyEditor",
    description: "Open-source LaTeX editor with live PDF preview",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#191715" },
    { media: "(prefers-color-scheme: light)", color: "#fdfcfb" },
  ],
};

// Applies the stored theme before first paint. Without this, light-mode
// users get a dark flash on every navigation, because ThemeProvider can
// only read localStorage after hydration.
const themeScript = `(function(){try{var t=localStorage.getItem("myeditor-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})()`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
