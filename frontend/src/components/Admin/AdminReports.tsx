/**
 * Admin feature component: AdminReports. Triage user-submitted showtime
 * reports (incorrect movie/time, doesn't exist, etc).
 */
import { Badge, Box, Button, Heading, Stack, Table } from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import { type ApiError, AdminService, type ShowtimeReportAdminView } from "shared"

const ReportRow = ({ report }: { report: ShowtimeReportAdminView }) => {
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()

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
    <Table.Row>
      <Table.Cell>{report.movie_title}</Table.Cell>
      <Table.Cell>{report.cinema_name}</Table.Cell>
      <Table.Cell>{report.showtime_datetime}</Table.Cell>
      <Table.Cell>{report.reason}</Table.Cell>
      <Table.Cell>{report.message ?? "—"}</Table.Cell>
      <Table.Cell>{report.reporter_email}</Table.Cell>
      <Table.Cell>
        <Badge>{report.status}</Badge>
      </Table.Cell>
      <Table.Cell>
        {report.status === "open" && (
          <Stack direction="row">
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
          </Stack>
        )}
      </Table.Cell>
    </Table.Row>
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
