/**
 * Shared web layout/presentation component: Search Bar.
 */
import { Input, InputGroup } from "@chakra-ui/react"
import { FaSearch } from "react-icons/fa"

type SearchBarProps = {
  query: string
  setQuery: (query: string) => void
  placeholder: string
}

export default function SearchBar({
  query,
  setQuery,
  placeholder,
}: SearchBarProps) {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  return (
    <InputGroup
      maxW={{ base: "100%", md: "400px" }}
      startElement={<FaSearch />}
      startElementProps={{ color: "fg.muted", fontSize: "1.2em" }}
    >
      <Input
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        bg="bg.panel"
        _hover={{ bg: "bg.subtle" }}
        _focus={{
          bg: "bg.panel",
          borderColor: "teal.400",
          boxShadow: "0 0 0 1px teal",
        }}
        borderRadius="md"
        size="md"
      />
    </InputGroup>
  )
}
