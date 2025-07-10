import { Input, Box } from "@chakra-ui/react";

type SearchBarProps = {
  query: string;
  setQuery: (query: string) => void;
};

export default function SearchBar({ query, setQuery }: SearchBarProps) {
  return (
    <Box
      position="sticky"
      top="0"
      zIndex="sticky"
      bg="white"
      px={4}
      py={2}
      boxShadow="sm"
    >
      <Input
        type="text"
        placeholder="Search for movies..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        bg="gray.50"
        _hover={{ bg: "gray.100" }}
        _focus={{ bg: "white", borderColor: "teal.400", boxShadow: "0 0 0 1px teal" }}
        borderRadius="md"
        size="md"
      />
    </Box>
  );
}
