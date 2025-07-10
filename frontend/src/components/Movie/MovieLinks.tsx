import { HStack } from '@chakra-ui/react';
import Badge from '@/components/Common/Badge';

type MovieLinksProps = {
  imdb?: string;
  letterboxd?: string;
};

export default function MovieLinks({ imdb, letterboxd }: MovieLinksProps) {
    return (
        <HStack gap={1} my={2}>
            {letterboxd &&
                <Badge
                    text={"Letterboxd"}
                    bgColor="gray.700"
                    textColor="white"
                    hoverColor="gray.800"
                    textSize="9px"
                    url={letterboxd}
                />
            }
            {imdb &&
                <Badge
                text={"IMDB"}
                bgColor="gray.700"
                textColor="white"
                hoverColor="gray.800"
                textSize="9px"
                url={imdb}
            />
            }
        </HStack>
    )

}
