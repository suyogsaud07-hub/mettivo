// src/app/layout.tsx
import './globals.css';

export const metadata = {
  title: 'Spark - Meet Your Kind of People',
  description: 'Premium International Dating & Connections Platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 text-white min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}