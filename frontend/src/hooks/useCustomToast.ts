/**
 * Custom web hook for Use Custom Toast. It encapsulates reusable stateful behavior.
 */
"use client"

import { toaster } from "@/components/ui/toaster"

const useCustomToast = () => {
  // Read flow: derive reusable behavior first, then expose the hook API.
  const showSuccessToast = (description: string) => {
    toaster.create({
      title: "Success!",
      description,
      type: "success",
    })
  }

  const showErrorToast = (description: string) => {
    toaster.create({
      title: "Something went wrong!",
      description,
      type: "error",
    })
  }

  // Return the hook API that callers consume.
  return { showSuccessToast, showErrorToast }
}

export default useCustomToast
