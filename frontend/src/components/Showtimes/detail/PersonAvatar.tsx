/**
 * A person: their Letterboxd profile picture when they have one linked and
 * synced, a coloured initial otherwise — and always the initial underneath,
 * so a picture that fails to load (a stale URL, a network hiccup) falls back
 * to it rather than leaving a blank circle.
 *
 * The initial's colour is `shared/users/avatar-color`, the rule the app uses
 * too, so somebody who is teal in the app is teal here. It has to survive
 * re-ordering, filtering and moving between screens, which is why it comes
 * from the id rather than from a position in a list.
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
import { Box, Flex, Image, Text } from "@chakra-ui/react"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import type { ReactNode } from "react"
import type { UserPublic } from "shared"
import {
  getAvatarInitial,
  getAvatarPaletteKey,
} from "shared/users/avatar-color"
import { getAvatarSources } from "shared/users/avatar-sources"

import { PanelIcon } from "@/components/Showtimes/detail/panel-icons"
import { friendFeedSearch } from "@/features/showtimes/feed-params"

type PersonLike = Pick<UserPublic, "id" | "display_name" | "avatar_url">

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
  // A bigger render first when drawn large, then the stored one; a source
  // that fails is skipped for good, and none left means the initial.
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const photo = getAvatarSources(user.avatar_url, size).find(
    (src) => !failed.has(src),
  )

  return (
    <Flex
      as="span"
      position="relative"
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
      overflow="hidden"
      borderWidth={ring ? "2px" : undefined}
      borderColor={ring ? "bg.panel" : undefined}
      aria-hidden
    >
      {/* A line-height-1 box keeps the descender space below a capital, so a
          centred box leaves the letter sitting high; nudge it down in `em`
          so the correction scales with every avatar size. */}
      <Box as="span" position="relative" top="0.07em">
        {getAvatarInitial(user.display_name)}
      </Box>
      {photo ? (
        <Image
          key={photo}
          src={photo}
          alt=""
          position="absolute"
          inset={0}
          boxSize="100%"
          objectFit="cover"
          loading="lazy"
          onError={() => setFailed((current) => new Set(current).add(photo))}
        />
      ) : null}
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
    {/* A plain name read as a label, not a link. The chevron says "this goes
        somewhere" before the pointer arrives; the hover band and underline
        confirm it once it does. */}
    <Flex
      asChild
      align="center"
      gap="8px"
      flex="1"
      minW={0}
      mx="-4px"
      px="4px"
      py="2px"
      borderRadius="6px"
      transition="background-color 120ms ease"
      _hover={{
        bg: "bg.muted",
        "& [data-person-name]": { textDecoration: "underline" },
      }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "app.tint",
        outlineOffset: "1px",
      }}
    >
      <Link to="/" search={friendFeedSearch(user.id)}>
        <PersonAvatar user={user} />
        <Box minW={0}>
          <Text
            data-person-name
            fontSize="13px"
            fontWeight="600"
            lineHeight="1.3"
            textUnderlineOffset="2px"
            truncate
            // Only when this is the row's one line: with a caption below it,
            // the chevron centers against the whole two-line block instead.
            position={caption ? undefined : "relative"}
            top={caption ? undefined : "1px"}
          >
            {personName(user)}
          </Text>
          {caption ? (
            <Text fontSize="11px" color="fg.muted" lineHeight="1.3" truncate>
              {caption}
            </Text>
          ) : null}
        </Box>
        <Box
          as={PanelIcon.chevronRight}
          boxSize="16px"
          flexShrink={0}
          ml="-4px"
          color="fg.subtle"
          aria-hidden
        />
      </Link>
    </Flex>
    {trailing ? (
      <Flex align="center" gap="2px" flexShrink={0}>
        {trailing}
      </Flex>
    ) : null}
  </Flex>
)
