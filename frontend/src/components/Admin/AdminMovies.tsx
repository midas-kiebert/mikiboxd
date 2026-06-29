/**
 * Admin feature component: AdminMovies. Fix bad TMDB identifications on
 * already-stored movie rows, or override the TMDB lookup cache for future
 * scrapes.
 */
import { Box, Button, Heading, Input, Stack, Tabs } from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { type SubmitHandler, useForm } from "react-hook-form"

import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import {
  type AdminMoviePublic,
  AdminService,
  type ApiError,
  type MovieUpdate,
} from "shared"
import { Field } from "../ui/field"
import TmdbCacheOverrideForm from "./TmdbCacheOverrideForm"

const EditMovieForm = ({ movie }: { movie: AdminMoviePublic }) => {
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()
  const { register, handleSubmit } = useForm<MovieUpdate>({
    defaultValues: {
      title: movie.title,
      poster_link: movie.poster_link,
      duration: movie.duration,
      original_language: movie.original_language,
    },
  })

  const mutation = useMutation({
    mutationFn: (data: MovieUpdate) =>
      AdminService.updateMovie({ movieId: movie.id, requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Movie updated.")
      queryClient.invalidateQueries({ queryKey: ["admin", "movies"] })
    },
    onError: (err: ApiError) => handleError(err),
  })

  const onSubmit: SubmitHandler<MovieUpdate> = (data) => mutation.mutate(data)

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Stack gap={3} maxW="md">
        <Field label="Title">
          <Input {...register("title")} />
        </Field>
        <Field label="Poster link">
          <Input {...register("poster_link")} />
        </Field>
        <Field label="Duration (minutes)">
          <Input type="number" {...register("duration")} />
        </Field>
        <Field label="Original language (ISO-639-1)">
          <Input {...register("original_language")} />
        </Field>
        <Button type="submit" loading={mutation.isPending} alignSelf="start">
          Save movie record
        </Button>
      </Stack>
    </form>
  )
}

const AdminMovies = () => {
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<AdminMoviePublic | null>(null)

  const { data: results } = useQuery({
    queryKey: ["admin", "movies", query],
    queryFn: () => AdminService.searchMovies({ q: query, limit: 25 }),
    enabled: query.length > 1,
  })

  return (
    <Box>
      <Heading size="md" mb={4}>
        Movies
      </Heading>
      <Input
        placeholder="Search by title…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        maxW="md"
        mb={3}
      />
      <Stack gap={1} mb={6}>
        {results?.map((movie) => (
          <Box
            key={movie.id}
            p={2}
            borderWidth="1px"
            borderRadius="md"
            cursor="pointer"
            bg={selected?.id === movie.id ? "gray.subtle" : undefined}
            onClick={() => setSelected(movie)}
          >
            {movie.title} {movie.release_year ? `(${movie.release_year})` : ""}
          </Box>
        ))}
      </Stack>

      {selected && (
        <Tabs.Root defaultValue="edit" variant="subtle">
          <Tabs.List>
            <Tabs.Trigger value="edit">Edit movie record</Tabs.Trigger>
            <Tabs.Trigger value="override">
              Override TMDB lookup cache
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="edit">
            <EditMovieForm movie={selected} />
          </Tabs.Content>
          <Tabs.Content value="override">
            <TmdbCacheOverrideForm />
          </Tabs.Content>
        </Tabs.Root>
      )}
    </Box>
  )
}

export default AdminMovies
