/**
 * Admin feature component: TmdbCacheOverrideForm. Fixes the cached TMDB
 * lookup used by future scrapes of a given title — shared by the Movies tab
 * and the per-report "fix TMDB cache" action on the Reports tab.
 */
import { Button, Input, Stack, Text } from "@chakra-ui/react"
import { useMutation } from "@tanstack/react-query"
import { useForm } from "react-hook-form"

import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import { type ApiError, UtilsService } from "shared"
import { Field } from "../ui/field"

type TmdbCacheOverrideFormValues = {
  title_query: string
  director_names: string
  actor_name: string
  year?: number
  tmdb_id?: number
}

const TmdbCacheOverrideForm = ({
  defaultTitleQuery = "",
  onSuccess,
}: {
  defaultTitleQuery?: string
  onSuccess?: () => void
}) => {
  const { showSuccessToast } = useCustomToast()
  const { register, handleSubmit } = useForm<TmdbCacheOverrideFormValues>({
    defaultValues: {
      title_query: defaultTitleQuery,
      director_names: "",
      actor_name: "",
      year: undefined,
      tmdb_id: undefined,
    },
  })

  const mutation = useMutation({
    mutationFn: (data: TmdbCacheOverrideFormValues) =>
      UtilsService.overrideTmdbCacheEntry({
        requestBody: {
          title_query: data.title_query,
          director_names: data.director_names
            ? data.director_names.split(",").map((s) => s.trim())
            : [],
          actor_name: data.actor_name || null,
          year: data.year ?? null,
          tmdb_id: data.tmdb_id ?? null,
        },
      }),
    onSuccess: () => {
      showSuccessToast("Lookup cache entry updated.")
      onSuccess?.()
    },
    onError: (err: ApiError) => handleError(err),
  })

  return (
    <form
      onSubmit={handleSubmit((data) =>
        mutation.mutate({
          ...data,
          year: data.year ? Number(data.year) : undefined,
          tmdb_id: data.tmdb_id ? Number(data.tmdb_id) : undefined,
        }),
      )}
    >
      <Stack gap={3} maxW="md">
        <Text fontSize="sm" color="gray.500">
          Fixes the cached TMDB lookup so future scrapes of this title resolve
          correctly. Does not change movies already stored — use "Edit movie
          record" on the Movies tab for that.
        </Text>
        <Field label="Title as scraped">
          <Input {...register("title_query")} required />
        </Field>
        <Field label="Director names (comma separated)">
          <Input {...register("director_names")} />
        </Field>
        <Field label="Lead actor">
          <Input {...register("actor_name")} />
        </Field>
        <Field label="Release year">
          <Input type="number" {...register("year")} />
        </Field>
        <Field label="Correct TMDB ID">
          <Input type="number" {...register("tmdb_id")} required />
        </Field>
        <Button type="submit" loading={mutation.isPending} alignSelf="start">
          Override cache entry
        </Button>
      </Stack>
    </form>
  )
}

export default TmdbCacheOverrideForm
