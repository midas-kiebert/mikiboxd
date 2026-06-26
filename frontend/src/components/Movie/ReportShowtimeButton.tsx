/**
 * Single-movie detail feature component: Report Showtime Button.
 *
 * Lets a logged-in user flag a showtime as wrong (incorrect movie/time,
 * doesn't exist, duplicate) — surfaced to superusers on the admin
 * showtime-reports page.
 */
import {
  Button,
  CloseButton,
  Dialog,
  NativeSelect,
  Portal,
  Stack,
  Textarea,
} from "@chakra-ui/react"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"

import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import { type ApiError, ShowtimesService, type ShowtimeReportReason } from "shared"
import { Field } from "../ui/field"

const REASON_OPTIONS: { value: ShowtimeReportReason; label: string }[] = [
  { value: "incorrect_movie", label: "Wrong movie" },
  { value: "incorrect_time", label: "Wrong time" },
  { value: "does_not_exist", label: "Doesn't exist" },
  { value: "duplicate", label: "Duplicate" },
  { value: "other", label: "Other" },
]

const ReportShowtimeButton = ({ showtimeId }: { showtimeId: number }) => {
  const { showSuccessToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ShowtimeReportReason>("incorrect_time")
  const [message, setMessage] = useState("")

  const mutation = useMutation({
    mutationFn: () =>
      ShowtimesService.reportShowtime({
        showtimeId,
        requestBody: { reason, message: message || null },
      }),
    onSuccess: () => {
      showSuccessToast("Thanks! We'll take a look at this showtime.")
      setOpen(false)
      setMessage("")
    },
    onError: (err: ApiError) => handleError(err),
  })

  return (
    <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      <Dialog.Trigger asChild>
        <Button size="xs" variant="ghost" colorPalette="gray">
          Report an issue
        </Button>
      </Dialog.Trigger>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content p={4}>
            <Dialog.Header>Report this showtime</Dialog.Header>
            <Dialog.CloseTrigger asChild>
              <CloseButton position="absolute" top={2} right={2} />
            </Dialog.CloseTrigger>
            <Dialog.Body>
              <Stack gap={3}>
                <Field label="What's wrong?">
                  <NativeSelect.Root>
                    <NativeSelect.Field
                      value={reason}
                      onChange={(e) =>
                        setReason(e.target.value as ShowtimeReportReason)
                      }
                    >
                      {REASON_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Field>
                <Field label="Details (optional)">
                  <Textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Anything else we should know?"
                  />
                </Field>
                <Button
                  alignSelf="end"
                  loading={mutation.isPending}
                  onClick={() => mutation.mutate()}
                >
                  Submit report
                </Button>
              </Stack>
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

export default ReportShowtimeButton
