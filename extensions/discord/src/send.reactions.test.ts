import { expect, it, vi } from "vitest";
import { RequestClient } from "./internal/rest.js";
import { reactMessageDiscord, removeReactionDiscord } from "./send.reactions.js";

it.each([undefined, [], ["reaction-conversations"]])(
  "preserves uncertain receipts with capabilities=%j and passive retry defaults",
  async (capabilities) => {
    for (const mutate of [reactMessageDiscord, removeReactionDiscord]) {
      const failure = Object.assign(new Error("connection reset after possible acceptance"), {
        code: "ECONNRESET",
      });
      const fetch = vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValue(new Response(null, { status: 204 }));
      const pending = mutate("150000000000000001", "150000000000000002", "✅", {
        cfg: { channels: { discord: { token: "synthetic-reaction-test", capabilities } } },
        rest: new RequestClient("synthetic-reaction-test", { fetch }),
        retry: { attempts: 2, minDelayMs: 0, maxDelayMs: 0, jitter: 0 },
      });
      if (capabilities?.includes("reaction-conversations")) {
        await expect(pending).rejects.toBe(failure);
        expect(fetch).toHaveBeenCalledTimes(1);
      } else {
        await expect(pending).resolves.toEqual({ ok: true });
        expect(fetch).toHaveBeenCalledTimes(2);
      }
    }
  },
);
