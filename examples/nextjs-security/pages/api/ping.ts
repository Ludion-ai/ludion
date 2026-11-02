// An API route of the older router: gate 3's crawl does not call it.
import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(_request: NextApiRequest, response: NextApiResponse) {
  response.status(200).json({ ok: true });
}
