import { Heading } from "@chakra-ui/react";

type MovieTitleProps = {
    title: string;
};

export default function MovieTitle({ title }: MovieTitleProps) {
    return (
        <Heading
            as="h3"
            size="xl"
            bg={"green.200"}
        >
            {title} (Original Title)
        </Heading>
    );
}
