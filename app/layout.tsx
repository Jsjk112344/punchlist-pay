import type {Metadata} from "next";
import "./globals.css";
export const metadata:Metadata={title:"Punchlist Pay",description:"Work orders, verified payouts."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
