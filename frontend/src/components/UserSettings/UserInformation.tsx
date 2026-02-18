/**
 * User settings feature component: User Information.
 */
import {
  Box,
  Button,
  Container,
  Flex,
  Heading,
  Input,
  Text,
} from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { type SubmitHandler, useForm } from "react-hook-form"

import {
  type ApiError,
  type UserUpdate,
  MeService,
} from "shared"
import useAuth from "shared/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { emailPattern, handleError } from "@/utils"
import { Field } from "../ui/field"

const UserInformation = () => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()
  const [editMode, setEditMode] = useState(false)
  // Data hooks keep this module synced with backend data and shared cache state.
  const { user: currentUser } = useAuth()
  const {
    register,
    handleSubmit,
    reset,
    getValues,
    formState: { isSubmitting, errors, isDirty },
  } = useForm<UserUpdate>({
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      display_name: currentUser?.display_name,
      email: currentUser?.email,
      letterboxd_username: currentUser?.letterboxd_username,
    },
  })

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  const mutation = useMutation({
    mutationFn: (data: UserUpdate) =>
      MeService.updateUserMe({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast("User updated successfully.")
      reset(getValues())
    },
    onError: (err: ApiError) => {
      handleError(err)
    },
    onSettled: () => {
      queryClient.invalidateQueries()
    },
  })

  const onSubmit: SubmitHandler<UserUpdate> = async (data) => {
    mutation.mutate(data)
  }

  const onCancel = () => {
    reset()
    toggleEditMode()
  }

  // Render/output using the state and derived values prepared above.
  return (
    <>
      <Container maxW="full">
        <Heading size="sm" py={4}>
          User Information
        </Heading>
        <Box
          w={{ sm: "full", md: "sm" }}
          as="form"
          onSubmit={handleSubmit(onSubmit)}
        >
          <Field label="Full name">
            {editMode ? (
              <Input
                {...register("display_name", { maxLength: 30 })}
                type="text"
                size="md"
              />
            ) : (
              <Text
                fontSize="md"
                py={2}
                color={!currentUser?.display_name ? "gray" : "inherit"}
                truncate
                maxW="sm"
              >
                {currentUser?.display_name || "N/A"}
              </Text>
            )}
          </Field>
          <Field
            mt={4}
            label="Email"
            invalid={!!errors.email}
            errorText={errors.email?.message}
          >
            {editMode ? (
              <Input
                {...register("email", {
                  required: "Email is required",
                  pattern: emailPattern,
                })}
                type="email"
                size="md"
              />
            ) : (
              <Text fontSize="md" py={2} truncate maxW="sm">
                {currentUser?.email}
              </Text>
            )}
          </Field>
          <Field
            mt={4}
            label="Letterboxd Username"
            invalid={!!errors.letterboxd_username}
            errorText={errors.letterboxd_username?.message}
          >
            {editMode ? (
              <Input
              {...register("letterboxd_username")}
                type="text"
                size="md"
              />
            ) : (
              <Text fontSize="md" py={2} truncate maxW="sm">
                {currentUser?.letterboxd_username ?? "N/A"}
              </Text>
            )}
          </Field>
          <Flex mt={4} gap={3}>
            <Button
              variant="solid"
              onClick={toggleEditMode}
              type={editMode ? "button" : "submit"}
              loading={editMode ? isSubmitting : false}
              disabled={editMode ? !isDirty || !getValues("email") : false}
            >
              {editMode ? "Save" : "Edit"}
            </Button>
            {editMode && (
              <Button
                variant="subtle"
                colorPalette="gray"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            )}
          </Flex>
        </Box>
      </Container>
    </>
  )
}

export default UserInformation
