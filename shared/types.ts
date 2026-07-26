import { UseMutationResult } from "@tanstack/react-query";
import {
  UserPublic,
  ApiError,
  UserRegister,
  MeGetCurrentUserResponse,
  Body_login_login_access_token as AccessToken,
  SocialLoginRequest,
} from "./client";

export type AuthHook = {
  signUpMutation: UseMutationResult<UserPublic, ApiError, UserRegister, unknown>;
  loginMutation: UseMutationResult<void, ApiError, AccessToken, unknown>;
  socialLoginMutation: UseMutationResult<
    { needsUsername: boolean },
    ApiError,
    SocialLoginRequest,
    unknown
  >;
  logout: () => void;
  user: MeGetCurrentUserResponse | null | undefined;
  error: string | null;
  resetError: () => void;
};
