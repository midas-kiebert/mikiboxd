import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { storage } from "../storage"
import type { AuthHook } from "../types"

import {
  type Body_login_login_access_token as AccessToken,
  type ApiError,
  LoginService,
  type MeGetCurrentUserResponse,
  type UserRegister,
  UsersService,
  MeService
} from "../client"
import { handleError } from "../utils"

const isLoggedIn = async () => {
  const token = await storage.getItem("access_token")
  return token !== null
}

const useAuth = (onLoginSuccess?: () => void, onLogout?: () => void): AuthHook => {
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useState(() => {
    isLoggedIn().then(setIsAuthenticated)
  })

  const {data: user } = useQuery<MeGetCurrentUserResponse | null, Error>({
    queryKey: ["currentUser"],
    queryFn: MeService.getCurrentUser,
    enabled: isAuthenticated,
  })

  const signUpMutation = useMutation({
    mutationFn: (data: UserRegister) =>
      UsersService.registerUser({ requestBody: data }),
    onSuccess: () => {
      if (onLoginSuccess) onLoginSuccess()
    },
    onError: (err: ApiError) => {
      handleError(err)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] })
    },
  })


  const login = async (data: AccessToken) => {
    const response = await LoginService.loginAccessToken({
      formData: data,
    })
    await storage.setItem("access_token", response.access_token)
    setIsAuthenticated(true)
  }

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: () => {
      if (onLoginSuccess) onLoginSuccess()
    },
    onError: (err: ApiError) => {
      handleError(err)
    },
  })

  const logout = async () => {
    await storage.removeItem("access_token")
    setIsAuthenticated(false)
    queryClient.clear()
    if (onLogout) onLogout()
  }

  return {
    signUpMutation,
    loginMutation,
    logout,
    user,
    error,
    resetError: () => setError(null),
  }
}

export { isLoggedIn }
export default useAuth
