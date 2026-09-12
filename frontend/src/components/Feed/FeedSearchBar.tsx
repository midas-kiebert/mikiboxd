/**
 * The feed's search field and the thing it is searching.
 *
 * One control, not two: the field and the scope selector share a track, the
 * way they do in the app (`mobile/components/inputs/SearchBar.tsx`), because
 * "Director" is not a setting that happens to sit near the search box — it is
 * half of what the box means. A bare `<select>` beside a bare `<input>` read as
 * two unrelated widgets and left the placeholder saying "Search showtimes…"
 * while the scope said something else entirely.
 *
 * The placeholder is the scope's, so the two can never disagree, and the
 * clear button sits in a slot of a fixed width so the field does not resize as
 * you type.
 *
 * Fills whatever it is given. The toolbar decides how wide the field is and
 * where it sits, because that is a question about the row, not about the field.
 */
import { Box, Flex, Icon, Input, Text } from "@chakra-ui/react"
import type { IconType } from "react-icons"
import {
  FiChevronDown,
  FiFilm,
  FiMapPin,
  FiSearch,
  FiUser,
  FiUsers,
  FiVideo,
  FiX,
} from "react-icons/fi"

import { useIsSignedIn } from "@/auth/useSession"
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from "@/components/ui/menu"
import type { SearchField } from "shared/client"

/**
 * The scopes, their wording and their placeholders, mirroring the app's own
 * list so the two clients ask the same question. Icons are the nearest Feather
 * equivalents of the app's Material ones, kept distinct for the three that are
 * all film-related.
 */
const SEARCH_FIELDS: {
  value: SearchField
  label: string
  placeholder: string
  icon: IconType
  /** Searching by friend needs friends, which needs an account. */
  accountOnly?: boolean
}[] = [
  { value: "title", label: "Title", placeholder: "Search title", icon: FiFilm },
  {
    value: "director",
    label: "Director",
    placeholder: "Search director",
    icon: FiVideo,
  },
  { value: "actor", label: "Actor", placeholder: "Search actor", icon: FiUser },
  {
    value: "cinema",
    label: "Cinema",
    placeholder: "Search cinema",
    icon: FiMapPin,
  },
  {
    value: "friend",
    label: "Friends",
    placeholder: "Search friends",
    icon: FiUsers,
    accountOnly: true,
  },
]

/** Matches the app's search field: a pill, at its type size. */
const FIELD_HEIGHT = "44px"
const FIELD_FONT_SIZE = "16px"
/** Reserved so the box never resizes as the clear button comes and goes. */
const CLEAR_SLOT_WIDTH = "32px"

type FeedSearchBarProps = {
  query: string
  onQueryChange: (query: string) => void
  field: SearchField
  onFieldChange: (field: SearchField) => void
  /** Overrides the scope's own placeholder, for a page that searches one thing. */
  placeholder?: string
}

const FeedSearchBar = ({
  query,
  onQueryChange,
  field,
  onFieldChange,
  placeholder,
}: FeedSearchBarProps) => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const isSignedIn = useIsSignedIn()
  const options = SEARCH_FIELDS.filter(
    (option) => isSignedIn || !option.accountOnly,
  )
  const active = SEARCH_FIELDS.find((option) => option.value === field)

  // Render/output using the state and derived values prepared above.
  return (
    <Flex
      align="center"
      h={FIELD_HEIGHT}
      pl={4}
      pr="4px"
      gap={2}
      w="100%"
      minW={0}
      bg="app.searchBackground"
      borderWidth="1px"
      borderColor="border"
      borderRadius="full"
      transition="border-color 120ms ease"
      _focusWithin={{ borderColor: "app.tint" }}
    >
      <Icon as={FiSearch} boxSize="18px" color="fg.subtle" flexShrink={0} />

      <Input
        variant="subtle"
        bg="transparent"
        border="none"
        px={0}
        h="100%"
        flex="1"
        minW={0}
        fontSize={FIELD_FONT_SIZE}
        _focusVisible={{ boxShadow: "none", outline: "none" }}
        value={query}
        placeholder={placeholder ?? active?.placeholder ?? "Search"}
        aria-label={placeholder ?? active?.placeholder ?? "Search"}
        onChange={(event) => onQueryChange(event.target.value)}
      />

      <Box w={CLEAR_SLOT_WIDTH} flexShrink={0}>
        {query ? (
          <Box
            as="button"
            type="button"
            aria-label="Clear search"
            onClick={() => onQueryChange("")}
            display="flex"
            alignItems="center"
            justifyContent="center"
            boxSize="28px"
            borderRadius="full"
            color="fg.subtle"
            cursor="pointer"
            _hover={{ bg: "bg.subtle", color: "fg" }}
          >
            <FiX />
          </Box>
        ) : null}
      </Box>

      <Box w="1px" h="22px" bg="border" flexShrink={0} />

      <MenuRoot positioning={{ placement: "bottom-end" }}>
        <MenuTrigger asChild>
          <Flex
            as="button"
            aria-label={`Search by ${active?.label ?? "title"}`}
            align="center"
            gap={1}
            flexShrink={0}
            h="36px"
            px={3}
            borderRadius="full"
            cursor="pointer"
            color="fg.muted"
            transition="background 120ms ease, color 120ms ease"
            _hover={{ bg: "bg.subtle", color: "fg" }}
          >
            <Text fontSize="sm" fontWeight="semibold" whiteSpace="nowrap">
              {active?.label ?? "Title"}
            </Text>
            <Icon as={FiChevronDown} boxSize="16px" />
          </Flex>
        </MenuTrigger>

        <MenuContent minW="180px">
          {options.map((option) => (
            <MenuItem
              key={option.value}
              value={option.value}
              closeOnSelect
              gap={2}
              py={2}
              onClick={() => onFieldChange(option.value)}
              style={{ cursor: "pointer" }}
            >
              <Icon as={option.icon} boxSize="16px" />
              <Box flex="1">{option.label}</Box>
            </MenuItem>
          ))}
        </MenuContent>
      </MenuRoot>
    </Flex>
  )
}

export default FeedSearchBar
