/**
 * Admin feature component: AdminReports. Triage user-submitted showtime
 * reports (incorrect movie/time, doesn't exist, etc), grouped by showtime and
 * sorted by how often each showtime was reported, with the underlying
 * showtime fixable without leaving the page.
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
  Tabs,
  Text,
} from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import {
  AdminService,
  type ApiError,
  type ShowtimeReportAdminView,
  type ShowtimeReportReason,
} from "shared"
import { Field } from "../ui/field"
import TmdbCacheOverrideForm from "./TmdbCacheOverrideForm"

const REASON_COLORS: Record<ShowtimeReportReason, string> = {
  incorrect_movie: "purple",
  incorrect_time: "orange",
  does_not_exist: "red",
  duplicate: "yellow",
  wrong_subtitles: "cyan",
  other: "gray",
}

const BAN_PRESETS = [
  { label: "1 day", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "Forever", days: null as number | null },
]

type ReportGroup = {
  showtimeId: number
  reports: ShowtimeReportAdminView[]
  isOpen: boolean
}

const groupReports = (reports: ShowtimeReportAdminView[]): ReportGroup[] => {
  const byShowtime = new Map<number, ShowtimeReportAdminView[]>()
  for (const report of reports) {
    const existing = byShowtime.get(report.showtime_id)
    if (existing) {
      existing.push(report)
    } else {
      byShowtime.set(report.showtime_id, [report])
    }
  }
  return Array.from(byShowtime.entries())
    .map(([showtimeId, groupReports]) => ({
      showtimeId,
      reports: groupReports,
      isOpen: groupReports.some((r) => r.status === "open"),
    }))
    .sort((a, b) => {
      if (b.reports.length !== a.reports.length) {
        return b.reports.length - a.reports.length
      }
      return (
        new Date(b.reports[0].created_at).getTime() -
        new Date(a.reports[0].created_at).getTime()
      )
    })
}

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

const BanReporterButton = ({
  reporterId,
  reporterEmail,
  banned,
}: {
  reporterId: string
  reporterEmail: string
  banned: boolean
}) => {
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()
  const [isOpen, setIsOpen] = useState(false)
  const [customDays, setCustomDays] = useState("")

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "showtime-reports"] })

  const banMutation = useMutation({
    mutationFn: (durationDays: number | null) =>
      AdminService.updateUserReportBan({
        userId: reporterId,
        requestBody: { banned: true, duration_days: durationDays },
      }),
    onSuccess: () => {
      showSuccessToast(`${reporterEmail} banned from reporting.`)
      invalidate()
      setIsOpen(false)
    },
    onError: (err: ApiError) => handleError(err),
  })

  const unbanMutation = useMutation({
    mutationFn: () =>
      AdminService.updateUserReportBan({
        userId: reporterId,
        requestBody: { banned: false },
      }),
    onSuccess: () => {
      showSuccessToast(`${reporterEmail} unbanned.`)
      invalidate()
    },
    onError: (err: ApiError) => handleError(err),
  })

  if (banned) {
    return (
      <Button
        size="xs"
        variant="ghost"
        colorPalette="green"
        loading={unbanMutation.isPending}
        onClick={() => unbanMutation.mutate()}
      >
        Unban reporter
      </Button>
    )
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={(e) => setIsOpen(e.open)}>
      <Dialog.Trigger asChild>
        <Button size="xs" variant="ghost" colorPalette="red">
          Ban reporter
        </Button>
      </Dialog.Trigger>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content p={4}>
            <Dialog.Header>Ban {reporterEmail} from reporting</Dialog.Header>
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
              <Stack gap={3}>
                <Stack direction="row" wrap="wrap">
                  {BAN_PRESETS.map((preset) => (
                    <Button
                      key={preset.label}
                      size="sm"
                      loading={banMutation.isPending}
                      onClick={() => banMutation.mutate(preset.days)}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </Stack>
                <Field label="Custom (days)">
                  <Stack direction="row">
                    <Input
                      size="sm"
                      type="number"
                      value={customDays}
                      onChange={(e) => setCustomDays(e.target.value)}
                    />
                    <Button
                      size="sm"
                      loading={banMutation.isPending}
                      disabled={!customDays}
                      onClick={() => banMutation.mutate(Number(customDays))}
                    >
                      Ban
                    </Button>
                  </Stack>
                </Field>
              </Stack>
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

const ReportRow = ({
  report,
  isFirstInGroup,
  reportCount,
}: {
  report: ShowtimeReportAdminView
  isFirstInGroup: boolean
  reportCount: number
}) => {
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

  const deleteShowtimeMutation = useMutation({
    mutationFn: () =>
      AdminService.deleteShowtime({ showtimeId: report.showtime_id }),
    onSuccess: () => {
      showSuccessToast("Showtime deleted.")
      invalidate()
    },
    onError: (err: ApiError) => handleError(err),
  })

  const resolvedOrDismissed = report.status !== "open"
  const rowColor = resolvedOrDismissed
    ? report.status === "resolved"
      ? "green.subtle"
      : "gray.subtle"
    : undefined

  return (
    <>
      <Table.Row bg={rowColor}>
        <Table.Cell>
          {isFirstInGroup && reportCount > 1 && (
            <Badge colorPalette="red" mr={2}>
              ×{reportCount}
            </Badge>
          )}
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
        <Table.Cell>
          {report.ticket_link ? (
            <Link
              href={report.ticket_link}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ticket
            </Link>
          ) : (
            "—"
          )}
        </Table.Cell>
        <Table.Cell>
          <Badge colorPalette={REASON_COLORS[report.reason]}>
            {report.reason}
          </Badge>
        </Table.Cell>
        <Table.Cell>{report.message ?? "—"}</Table.Cell>
        <Table.Cell>
          <Stack direction="row" align="center" gap={1}>
            <Text>{report.reporter_email}</Text>
            <BanReporterButton
              reporterId={report.reporter_id}
              reporterEmail={report.reporter_email}
              banned={report.reporter_report_banned}
            />
          </Stack>
        </Table.Cell>
        <Table.Cell>
          <Badge
            colorPalette={
              report.status === "resolved"
                ? "green"
                : report.status === "dismissed"
                  ? "gray"
                  : "blue"
            }
          >
            {report.status}
          </Badge>
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
            <Button
              size="sm"
              variant="ghost"
              colorPalette="red"
              loading={deleteShowtimeMutation.isPending}
              onClick={() => {
                if (
                  confirm(
                    `Delete this showtime for "${report.movie_title}"? This removes it for everyone.`,
                  )
                ) {
                  deleteShowtimeMutation.mutate()
                }
              }}
            >
              Delete showtime
            </Button>
          </Stack>
        </Table.Cell>
      </Table.Row>
      {isFixOpen && (
        <Table.Row bg={rowColor}>
          <Table.Cell colSpan={9}>
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

const ReportsTable = ({ groups }: { groups: ReportGroup[] }) => (
  <Table.Root size="sm">
    <Table.Header>
      <Table.Row>
        <Table.ColumnHeader>Movie</Table.ColumnHeader>
        <Table.ColumnHeader>Cinema</Table.ColumnHeader>
        <Table.ColumnHeader>Showtime</Table.ColumnHeader>
        <Table.ColumnHeader>Ticket</Table.ColumnHeader>
        <Table.ColumnHeader>Reason</Table.ColumnHeader>
        <Table.ColumnHeader>Message</Table.ColumnHeader>
        <Table.ColumnHeader>Reporter</Table.ColumnHeader>
        <Table.ColumnHeader>Status</Table.ColumnHeader>
        <Table.ColumnHeader>Actions</Table.ColumnHeader>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {groups.map((group) =>
        group.reports.map((report, index) => (
          <ReportRow
            key={report.id}
            report={report}
            isFirstInGroup={index === 0}
            reportCount={group.reports.length}
          />
        )),
      )}
    </Table.Body>
  </Table.Root>
)

const AdminReports = () => {
  const { data: reports } = useQuery({
    queryKey: ["admin", "showtime-reports"],
    queryFn: () => AdminService.listShowtimeReports({}),
  })

  const { openGroups, closedGroups } = useMemo(() => {
    const groups = groupReports(reports ?? [])
    return {
      openGroups: groups.filter((g) => g.isOpen),
      closedGroups: groups.filter((g) => !g.isOpen),
    }
  }, [reports])

  return (
    <Box>
      <Heading size="md" mb={4}>
        Showtime reports
      </Heading>
      <Tabs.Root defaultValue="open" variant="subtle">
        <Tabs.List>
          <Tabs.Trigger value="open">Open ({openGroups.length})</Tabs.Trigger>
          <Tabs.Trigger value="closed">
            Resolved / dismissed ({closedGroups.length})
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="open">
          <ReportsTable groups={openGroups} />
        </Tabs.Content>
        <Tabs.Content value="closed">
          <ReportsTable groups={closedGroups} />
        </Tabs.Content>
      </Tabs.Root>
    </Box>
  )
}

export default AdminReports
