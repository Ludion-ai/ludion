// The build reads this, so a project with no values for .env.example's keys does not build.
export const siteName = process.env.NEXT_PUBLIC_SITE_NAME;
if (!siteName) throw new Error("NEXT_PUBLIC_SITE_NAME is required");
if (!process.env.API_URL) throw new Error("API_URL is required");
