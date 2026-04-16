const { z } = require("zod");

const emailSchema = z
  .string()
  .email("Invalid email format")
  .transform((value) => value.trim().toLowerCase());

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must include at least one uppercase letter")
  .regex(/[0-9]/, "Password must include at least one number");

const signupSchema = z.object({
  body: z.object({
    email: emailSchema,
    password: passwordSchema,
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  }),
  params: z.object({}),
  query: z.object({}),
});

const loginSchema = z.object({
  body: z.object({
    email: emailSchema,
    password: z.string().min(1, "Password is required"),
  }),
  params: z.object({}),
  query: z.object({}),
});

const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, "Refresh token is required"),
  }),
  params: z.object({}),
  query: z.object({}),
});

const logoutSchema = refreshTokenSchema;

module.exports = {
  signupSchema,
  loginSchema,
  refreshTokenSchema,
  logoutSchema,
};
