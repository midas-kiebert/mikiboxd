import { UseMutationResult } from "@tanstack/react-query";
import { UserPublic, ApiError, UserRegister, Body_login_login_access_token as AccessToken } from "./client";

export type AuthHook = {
  signUpMutation: UseMutationResult<UserPublic, ApiError, UserRegister, unknown>;
  loginMutation: UseMutationResult<void, ApiError, AccessToken, unknown>;
  logout: () => void;
  user: UserPublic | null | undefined;
  error: string | null;
  resetError: () => void;
};
