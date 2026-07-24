/**
 * Admin feature component: AdminShowtimes. Edit or delete a bad showtime row.
 */
import { Box, Button, Heading, Input, Stack, Table } from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import { AdminService, type AdminShowtimePublic, type ApiError } from "shared"
import { Field } from "../ui/field"

const EditShowtimeRow = ({ showtime }: { showtime: AdminShowtimePublic }) => {
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()
  const [ticketLink, setTicketLink] = useState(showtime.ticket_link ?? "")
  const [datetime, setDatetime] = useState(showtime.datetime.slice(0, 16))

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "showtimes"] })

  const updateMutation = useMutation({
    mutationFn: () =>
      AdminService.updateShowtime({
        showtimeId: showtime.id,
        requestBody: { ticket_link: ticketLink, datetime },
      }),
    onSuccess: () => {
      showSuccessToast("Showtime updated.")
      invalidate()
    },
    onError: (err: ApiError) => handleError(err),
  })

  const deleteMutation = useMutation({
    mutationFn: () => AdminService.deleteShowtime({ showtimeId: showtime.id }),
    onSuccess: () => {
      showSuccessToast("Showtime deleted.")
      invalidate()
    },
    onError: (err: ApiError) => handleError(err),
  })

  return (
    <Table.Row>
      <Table.Cell>{showtime.movie_title}</Table.Cell>
      <Table.Cell>{showtime.cinema_name}</Table.Cell>
      <Table.Cell>
        <Input
          type="datetime-local"
          size="sm"
          value={datetime}
          onChange={(e) => setDatetime(e.target.value)}
        />
      </Table.Cell>
      <Table.Cell>
        <Input
          size="sm"
          value={ticketLink}
          onChange={(e) => setTicketLink(e.target.value)}
        />
      </Table.Cell>
      <Table.Cell>
        <Stack direction="row">
          <Button
            size="sm"
            loading={updateMutation.isPending}
            onClick={() => updateMutation.mutate()}
          >
            Save
          </Button>
          <Button
            size="sm"
            colorPalette="red"
            loading={deleteMutation.isPending}
            onClick={() => {
              if (
                confirm(`Delete this showtime for "${showtime.movie_title}"?`)
              ) {
                deleteMutation.mutate()
              }
            }}
          >
            Delete
          </Button>
        </Stack>
      </Table.Cell>
    </Table.Row>
  )
}

const AdminShowtimes = () => {
  const [movieId, setMovieId] = useState("")
  const [cinemaId, setCinemaId] = useState("")

  const { data: showtimes } = useQuery({
    queryKey: ["admin", "showtimes", movieId, cinemaId],
    queryFn: () =>
      AdminService.searchShowtimes({
        movieId: movieId ? Number(movieId) : undefined,
        cinemaId: cinemaId ? Number(cinemaId) : undefined,
        limit: 50,
      }),
  })

  return (
    <Box>
      <Heading size="md" mb={4}>
        Showtimes
      </Heading>
      <Stack direction="row" gap={4} mb={4} maxW="lg">
        <Field label="Movie ID">
          <Input value={movieId} onChange={(e) => setMovieId(e.target.value)} />
        </Field>
        <Field label="Cinema ID">
          <Input
            value={cinemaId}
            onChange={(e) => setCinemaId(e.target.value)}
          />
        </Field>
      </Stack>

      <Table.Root size="sm">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Movie</Table.ColumnHeader>
            <Table.ColumnHeader>Cinema</Table.ColumnHeader>
            <Table.ColumnHeader>Datetime</Table.ColumnHeader>
            <Table.ColumnHeader>Ticket link</Table.ColumnHeader>
            <Table.ColumnHeader>Actions</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {showtimes?.map((showtime) => (
            <EditShowtimeRow key={showtime.id} showtime={showtime} />
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  )
}

export default AdminShowtimes
