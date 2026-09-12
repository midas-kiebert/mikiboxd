/**
 * A person, drawn as a coloured initial.
 *
 * Which colour is `shared/users/avatar-color`, the rule the app uses too, so
 * somebody who is teal in the app is teal here. The point of the colour is
 * that it is *theirs*: it has to survive re-ordering, filtering and moving
 * between screens, which is why it comes from the id rather than from a
 * position in a list.
 *
 * Two shapes, one identity:
 *
 *   - `PersonAvatar`  — the circle alone.
 *   - `PersonChip`    — circle plus name, for a row of a few people.
 *
 * There was a third, an overlapping `AvatarStack` with a "+3", for the
 * collapsed attendance groups. It went with them: the audience is a wrap of
 * name pills now (`detail/FriendBadges`), the way the app draws it, and a
 * stack of faces you have to open to read answers the wrong question.
 *
 * A name links to that person's agenda wherever it is shown, because the
 * question "who else is going?" is almost always followed by "what else are
 * they going to?".
 */
import { Box, Flex, Text } from "@chakra-ui/react"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { UserPublic } from "shared"
import {
  getAvatarInitial,
  getAvatarPaletteKey,
} from "shared/users/avatar-color"

import { Tooltip } from "@/components/ui/tooltip"
import { defaultFeedParams } from "@/features/showtimes/feed-params"

type PersonLike = Pick<UserPublic, "id" | "display_name">

export const personName = (user: PersonLike): string =>
  user.display_name?.trim() || "Friend"

const avatarTokens = (user: PersonLike) => {
  const key = getAvatarPaletteKey(user.id)
  return { bg: `app.${key}.primary`, fg: `app.${key}.secondary` }
}

export const PersonAvatar = ({
  user,
  size = 24,
  ring = false,
}: {
  user: PersonLike
  size?: number
  /** A hairline in the card colour, so overlapping circles stay separable. */
  ring?: boolean
}) => {
  const { bg, fg } = avatarTokens(user)

  return (
    <Flex
      as="span"
      align="center"
      justify="center"
      boxSize={`${size}px`}
      borderRadius="full"
      bg={bg}
      color={fg}
      fontSize={`${Math.round(size * 0.45)}px`}
      fontWeight="700"
      lineHeight="1"
      flexShrink={0}
      borderWidth={ring ? "2px" : undefined}
      borderColor={ring ? "bg.panel" : undefined}
      aria-hidden
    >
      {getAvatarInitial(user.display_name)}
    </Flex>
  )
}

/**
 * Someone's circle and name, as a link to their agenda.
 *
 * `trailing` is where a row's own controls go — the marker saying they have
 * the film watchlisted, the seat they picked, the button to uninvite them —
 * so every list of people in the panel is the same row with different ends.
 */
export const PersonChip = ({
  user,
  caption,
  trailing,
}: {
  user: PersonLike
  /** A second line under the name: "Invited · seen", "Row F, seat 12". */
  caption?: ReactNode
  trailing?: ReactNode
}) => (
  <Flex align="center" gap={2} minW={0} py="2px">
    <Link
      to="/$userId/showtimes"
      params={{ userId: user.id }}
      search={defaultFeedParams}
      style={{ minWidth: 0, display: "flex", alignItems: "center", gap: "8px", flex: 1 }}
    >
      <PersonAvatar user={user} />
      <Box minW={0}>
        <Text fontSize="13px" fontWeight="500" lineHeight="1.3" truncate>
          {personName(user)}
        </Text>
        {caption ? (
          <Text fontSize="11px" color="fg.muted" lineHeight="1.3" truncate>
            {caption}
          </Text>
        ) : null}
      </Box>
    </Link>
    {trailing ? (
      <Flex align="center" gap="2px" flexShrink={0}>
        {trailing}
      </Flex>
    ) : null}
  </Flex>
)
