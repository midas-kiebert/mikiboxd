import {
  Badge,
  Container,
  Flex,
  Heading,
  Input,
  Stack,
  Text,
} from "@chakra-ui/react"
import { DateTime } from "luxon"
/**
 * Settings → Letterboxd lists.
 *
 * The feed could already filter by a list; there was no way to add one, so the
 * only lists a web user could reach were the curated ones. Add, re-sync and
 * remove are all here now.
 *
 * Curated lists are shown but not editable: they belong to everyone, and the
 * remove button on one would either lie or delete something for other people.
 */
import { useState } from "react"

import { useIsSignedIn } from "@/auth/useSession"
import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"
import {
  useFetchLetterboxdLists,
  useLetterboxdListMutations,
} from "shared/hooks/useLetterboxdLists"

/** "synced 3 hours ago", or nothing if it never has been. */
const formatSynced = (iso: string | null): string | null => {
  if (!iso) return null
  const dt = DateTime.fromISO(iso)
  return dt.isValid ? `synced ${dt.toRelative()}` : null
}

const LetterboxdLists = () => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const isSignedIn = useIsSignedIn()
  const { data: lists } = useFetchLetterboxdLists(isSignedIn)
  const { addList, syncList, removeList } = useLetterboxdListMutations()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [url, setUrl] = useState("")

  const handleAdd = () => {
    const trimmed = url.trim()
    if (!trimmed) return
    addList.mutate(trimmed, {
      onSuccess: () => {
        setUrl("")
        showSuccessToast("List added.")
      },
      onError: () =>
        showErrorToast(
          "Could not add that list. Check the URL points at a public Letterboxd list.",
        ),
    })
  }

  const own = lists?.filter((list) => !list.is_curated) ?? []
  const curated = lists?.filter((list) => list.is_curated) ?? []

  // Render/output using the state and derived values prepared above.
  return (
    <Container maxW="full">
      <Heading size="sm" py={4}>
        Letterboxd lists
      </Heading>

      <Text color="fg.muted" mb={4} maxW="prose">
        Add a public Letterboxd list and you can filter the feed down to it, or
        hide everything on it.
      </Text>

      <Flex gap={2} mb={6} maxW="lg">
        <Input
          size="sm"
          placeholder="https://letterboxd.com/…/list/…"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleAdd()
          }}
          aria-label="Letterboxd list URL"
        />
        <Button
          size="sm"
          loading={addList.isPending}
          disabled={url.trim() === ""}
          onClick={handleAdd}
        >
          Add
        </Button>
      </Flex>

      <Stack gap={4} maxW="lg">
        {own.length ? (
          <Stack gap={2}>
            {own.map((list) => (
              <Flex
                key={list.id}
                align="center"
                justify="space-between"
                gap={3}
              >
                <Stack gap={0} minW={0}>
                  <Text fontSize="sm" truncate>
                    {list.title ?? list.list_slug}
                  </Text>
                  <Text fontSize="xs" color="fg.muted">
                    {list.film_count} films
                    {formatSynced(list.last_synced)
                      ? ` · ${formatSynced(list.last_synced)}`
                      : ""}
                  </Text>
                </Stack>
                <Flex gap={1} flexShrink={0}>
                  <Button
                    size="xs"
                    variant="surface"
                    loading={syncList.isPending}
                    onClick={() => syncList.mutate(list.id)}
                  >
                    Re-sync
                  </Button>
                  <Button
                    size="xs"
                    variant="surface"
                    colorPalette="red"
                    onClick={() => removeList.mutate(list.id)}
                  >
                    Remove
                  </Button>
                </Flex>
              </Flex>
            ))}
          </Stack>
        ) : (
          <Text color="fg.muted" fontSize="sm">
            You haven't added any lists yet.
          </Text>
        )}

        {curated.length ? (
          <Stack gap={2}>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
              Curated lists — available to everyone
            </Text>
            {curated.map((list) => (
              <Flex key={list.id} align="center" gap={2}>
                <Text fontSize="sm">{list.title ?? list.list_slug}</Text>
                <Badge size="sm">{list.film_count} films</Badge>
              </Flex>
            ))}
          </Stack>
        ) : null}
      </Stack>
    </Container>
  )
}

export default LetterboxdLists
