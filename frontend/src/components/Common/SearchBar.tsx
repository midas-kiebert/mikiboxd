import { Input, InputGroup } from "@chakra-ui/react";
import { FaSearch } from "react-icons/fa";

type SearchBarProps = {
  query: string;
  setQuery: (query: string) => void;
  placeholder: string;
};

export default function SearchBar({ query, setQuery, placeholder }: SearchBarProps) {
  return (
      <InputGroup
        maxW={"30%"}
        startElement={<FaSearch/>}
        startElementProps={{ color: "gray.500", fontSize: "1.2em" }}
      >
        <Input
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          bg="gray.50"
          _hover={{ bg: "gray.100" }}
          _focus={{ bg: "white", borderColor: "teal.400", boxShadow: "0 0 0 1px teal" }}
          borderRadius="md"
          size="md"
        />
      </InputGroup>
  );
}
