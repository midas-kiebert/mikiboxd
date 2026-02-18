/**
 * Single-movie detail feature component: Movie Poster.
 */
import { Box, Image, Skeleton } from "@chakra-ui/react"
import { useState } from "react"

interface MoviePosterProps {
  posterUrl: string
  title?: string
  width?: string | number
  height?: string | number
  borderRadius?: string | number
}

export default function MoviePoster({
  posterUrl,
  title = "Movie Poster",
  width = "250px",
  height = "375px",
  borderRadius = "lg",
}: MoviePosterProps) {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  const [isLoaded, setIsLoaded] = useState(false)

  // Render/output using the state and derived values prepared above.
  return (
    <Box
      width={width}
      height={height}
      overflow="hidden"
      borderRadius={borderRadius}
      boxShadow="md"
      position="relative"
    >
      {!isLoaded && (
        <Skeleton width="100%" height="100%" position="absolute" top={0} left={0} />
      )}
      <Image
        src={posterUrl}
        alt={title}
        objectFit="cover"
        width="100%"
        height="100%"
        onLoad={() => setIsLoaded(true)}
        display={isLoaded ? "block" : "none"}
      />
    </Box>
  )
}
