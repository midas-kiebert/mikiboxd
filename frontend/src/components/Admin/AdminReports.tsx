/**
 * Admin feature component: AdminReports. Triage user-submitted showtime
 * reports (incorrect movie/time, doesn't exist, etc) and fix the underlying
 * showtime without leaving the page.
 */
import {
  Badge,
  Box,
  Button,
  Dialog,
  Heading,
  Input,
  Link,
  Portal,
  Stack,
  Table,
} from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import {
  AdminService,
  type ApiError,
  type ShowtimeReportAdminView,
} from "shared"
import { Field } from "../ui/field"
import TmdbCacheOverrideForm from "./TmdbCacheOverrideForm"

const EditShowtimePanel = ({ showtimeId }: { showtimeId: number }) => {
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()

  const { data: showtime } = useQuery({
    queryKey: ["admin", "showtime", showtimeId],
    queryFn: () => AdminService.getShowtime({ showtimeId }),
  })

  const [datetime, setDatetime] = useState<string | null>(null)
  const [ticketLink, setTicketLink] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      AdminService.updateShowtime({
        showtimeId,
        requestBody: {
          datetime: datetime ?? undefined,
          ticket_link: ticketLink ?? undefined,
        },
      }),
    onSuccess: () => {
      showSuccessToast("Showtime updated.")
      queryClient.invalidateQueries({
        queryKey: ["admin", "showtime", showtimeId],
      })
      queryClient.invalidateQueries({ queryKey: ["admin", "showtime-reports"] })
    },
    onError: (err: ApiError) => handleError(err),
  })

  if (!showtime) return null

  return (
    <Stack direction="row" gap={3} align="end" mt={2}>
      <Field label="Datetime">
        <Input
          type="datetime-local"
          size="sm"
          defaultValue={showtime.datetime.slice(0, 16)}
          onChange={(e) => setDatetime(e.target.value)}
        />
      </Field>
      <Field label="Ticket link">
        <Input
          size="sm"
          defaultValue={showtime.ticket_link ?? ""}
          onChange={(e) => setTicketLink(e.target.value)}
        />
      </Field>
      <Button
        size="sm"
        loading={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        Save showtime
      </Button>
    </Stack>
  )
}

const ReportRow = ({ report }: { report: ShowtimeReportAdminView }) => {
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()
  const [isFixOpen, setIsFixOpen] = useState(false)
  const [isTmdbDialogOpen, setIsTmdbDialogOpen] = useState(false)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "showtime-reports"] })

  const mutation = useMutation({
    mutationFn: (status: "resolved" | "dismissed") =>
      AdminService.updateShowtimeReport({
        reportId: report.id,
        requestBody: { status },
      }),
    onSuccess: () => {
      showSuccessToast("Report updated.")
      invalidate()
    },
    onError: (err: ApiError) => handleError(err),
  })

  return (
    <>
      <Table.Row>
        <Table.Cell>
          <Link
            href={`/movie/${report.movie_id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {report.movie_title}
          </Link>
        </Table.Cell>
        <Table.Cell>
          <Link
            href={report.cinema_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {report.cinema_name}
          </Link>
        </Table.Cell>
        <Table.Cell>{report.showtime_datetime}</Table.Cell>
        <Table.Cell>{report.reason}</Table.Cell>
        <Table.Cell>{report.message ?? "—"}</Table.Cell>
        <Table.Cell>{report.reporter_email}</Table.Cell>
        <Table.Cell>
          <Badge>{report.status}</Badge>
        </Table.Cell>
        <Table.Cell>
          <Stack direction="row" wrap="wrap">
            {report.status === "open" && (
              <>
                <Button
                  size="sm"
                  loading={mutation.isPending}
                  onClick={() => mutation.mutate("resolved")}
                >
                  Resolve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  loading={mutation.isPending}
                  onClick={() => mutation.mutate("dismissed")}
                >
                  Dismiss
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsFixOpen((open) => !open)}
            >
              {isFixOpen ? "Hide fix" : "Fix showtime"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsTmdbDialogOpen(true)}
            >
              Fix TMDB cache
            </Button>
          </Stack>
        </Table.Cell>
      </Table.Row>
      {isFixOpen && (
        <Table.Row>
          <Table.Cell colSpan={8}>
            <EditShowtimePanel showtimeId={report.showtime_id} />
          </Table.Cell>
        </Table.Row>
      )}
      <Dialog.Root
        open={isTmdbDialogOpen}
        onOpenChange={(e) => setIsTmdbDialogOpen(e.open)}
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content p={4}>
              <Dialog.Header>
                Fix TMDB cache for "{report.movie_title}"
              </Dialog.Header>
              <Dialog.CloseTrigger asChild>
                <Button
                  position="absolute"
                  top={2}
                  right={2}
                  size="xs"
                  variant="ghost"
                >
                  ✕
                </Button>
              </Dialog.CloseTrigger>
              <Dialog.Body>
                <TmdbCacheOverrideForm
                  defaultTitleQuery={report.movie_title}
                  onSuccess={() => setIsTmdbDialogOpen(false)}
                />
              </Dialog.Body>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </>
  )
}

const AdminReports = () => {
  const { data: reports } = useQuery({
    queryKey: ["admin", "showtime-reports"],
    queryFn: () => AdminService.listShowtimeReports({}),
  })

  return (
    <Box>
      <Heading size="md" mb={4}>
        Showtime reports
      </Heading>
      <Table.Root size="sm">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Movie</Table.ColumnHeader>
            <Table.ColumnHeader>Cinema</Table.ColumnHeader>
            <Table.ColumnHeader>Showtime</Table.ColumnHeader>
            <Table.ColumnHeader>Reason</Table.ColumnHeader>
            <Table.ColumnHeader>Message</Table.ColumnHeader>
            <Table.ColumnHeader>Reporter</Table.ColumnHeader>
            <Table.ColumnHeader>Status</Table.ColumnHeader>
            <Table.ColumnHeader>Actions</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {reports?.map((report) => (
            <ReportRow key={report.id} report={report} />
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  )
}

export default AdminReports
