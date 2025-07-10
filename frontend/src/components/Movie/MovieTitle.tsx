import { Heading } from "@chakra-ui/react";

interface MovieTitleProps {
  title: string;
}

export default function MovieTitle({ title }: MovieTitleProps) {
  return (
    <Heading
        as="h1"
        size="5xl"
        mb={4}
    >
      {title}
    </Heading>
  );
}
