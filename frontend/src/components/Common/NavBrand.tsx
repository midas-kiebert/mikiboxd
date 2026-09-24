/**
 * Shared web layout/presentation component: Nav Brand.
 *
 * The logo lockup at the left of the top nav, and the app's way home. The same
 * mark-over-wordmark pair the login and signup screens use, laid out
 * horizontally to fit a nav bar; on a phone the wordmark drops and the mark
 * stays as the bar's anchor.
 *
 * The mark is a wide ticket centred in a square, transparent canvas, so it is
 * sized by the box rather than cropped — its own padding is what keeps it off
 * the wordmark.
 */
import { Flex, Image, Text } from "@chakra-ui/react"
import { Link } from "@tanstack/react-router"

import { defaultFeedParams } from "@/features/showtimes/feed-params"
import Logo from "/assets/images/mikino-logo.png"

interface NavBrandProps {
  /** Closes the drawer when the lockup is used as a link on a phone. */
  onNavigate?: () => void
}

const NavBrand = ({ onNavigate }: NavBrandProps) => {
  // Render/output using the state and derived values prepared above.
  return (
    <Link
      to="/"
      search={defaultFeedParams}
      onClick={onNavigate}
      // The mark is decorative and the wordmark disappears on a phone, so the
      // link names itself rather than relying on either.
      aria-label="MiKiNO home"
      style={{ flexShrink: 0 }}
    >
      <Flex
        align="center"
        gap={2}
        h="44px"
        px={1}
        borderRadius="lg"
        transition="background 120ms ease"
        _hover={{ bg: "bg.subtle" }}
      >
        <Image
          src={Logo}
          alt=""
          boxSize="40px"
          flexShrink={0}
          // Decorative: the wordmark beside it already names the link, and the
          // link's own label covers the case where the wordmark is hidden.
          aria-hidden="true"
        />
        <Text
          fontSize="lg"
          fontWeight="bold"
          letterSpacing="-0.01em"
          color="fg"
          truncate
          display={{ base: "none", sm: "block" }}
          // Nudged: "MiKiNO" has no descenders, so its own line-box leaves
          // empty space below the letters that flex-centering still splits
          // evenly against the mark beside it, landing the ink high.
          position="relative"
          top="1px"
        >
          MiKiNO
        </Text>
      </Flex>
    </Link>
  )
}

export default NavBrand
