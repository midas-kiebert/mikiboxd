import CinemaToggle from '@/components/Common/CinemaToggle';
import { Box, Heading, Flex, Button } from '@chakra-ui/react';
import type { CityPublic, CinemaPublic } from '@/client';

type CityCinemasProps = {
    city: CityPublic;
    cinemasForCity: CinemaPublic[];
    selectedCinemas: number[];
    handleToggle: (cinemaId: number) => void;
    handleToggleCity: (cityId: number) => void;
};

const CityCinemas = (({
    city,
    cinemasForCity,
    selectedCinemas,
    handleToggle,
    handleToggleCity,
}: CityCinemasProps) => {

    const allSelected = cinemasForCity.every(cinema => selectedCinemas.includes(cinema.id));

    return (
        <Box key={city.id} mb={4}>
            <Flex>
                <Heading as="h3" size="md">
                    {city.name}:
                </Heading>
                <Button
                    size="2xs"
                    mb={2}
                    ml={2}
                    onClick={() => handleToggleCity(city.id)}
                    variant="surface"
                >
                    {allSelected ? 'Deselect All' : 'Select All'}
                </Button>
            </Flex>
            { cinemasForCity.map((cinema) => (
                <CinemaToggle
                    key={cinema.id}
                    cinema={cinema}
                    enabled={selectedCinemas.includes(cinema.id)}
                    handleToggle={handleToggle}
                />
            )) }
        </Box>
    )
});

export default CityCinemas;
