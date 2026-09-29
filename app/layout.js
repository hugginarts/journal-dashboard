import "./globals.css";

export const metadata = {
  title: 'SML LAB Dashboard',
  description: 'Smart Money Laboratory Intelligence',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}