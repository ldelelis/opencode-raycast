import { Rpc } from "@opencode/plugin/rpc";
import { z } from "zod";

export const request = z.object({
  requestID: z.uuid(),
  sessionID: z.string().regex(/^ses_[A-Za-z0-9]{26}$/),
  expiresAt: z.number().int().positive(),
});

export type OpenRequest = z.infer<typeof request>;

export const Launcher = Rpc.define({
  id: "session-launcher",
  methods: {
    openSession: {
      input: request.pick({ sessionID: true }),
      output: z.object({}),
      errors: {
        open_failed: z.object({}),
      },
    },
    pending: { input: z.object({}), output: z.array(request) },
    complete: {
      input: z.object({ requestID: z.uuid(), error: z.string().max(1000).optional() }),
      output: z.object({}),
    },
  },
  events: {
    requested: { schema: request },
  },
});
