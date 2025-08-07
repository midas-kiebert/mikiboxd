import FilterButton from "./FilterButton";
import { CloseButton, Dialog, Portal, Box, Heading } from '@chakra-ui/react'
import CinemaToggle from "../Common/CinemaToggle";
import {useFetchCinemas} from "@/hooks/useFetchCinemas";
import { useFetchSelectedCinemas } from "@/hooks/useFetchSelectedCinemas";
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MeService, MeSetCinemaSelectionsData } from "@/client";
import { useDebouncedCallback } from "use-debounce";
import type { CinemaPublic, CityPublic } from "@/client";


function useDebouncedCinemaMutation(delay = 500) {
    const queryClient = useQueryClient();

    const mutation = useMutation({
        mutationFn: (data: MeSetCinemaSelectionsData) => (
            MeService.setCinemaSelections(data)
        ),
        onSuccess: (_data, variables) => {
            console.log("Cinema selections updated successfully:", variables.requestBody)
            queryClient.setQueryData(["user", "cinema_selections"], variables.requestBody);
            queryClient.resetQueries({ queryKey: ["movies"] });
        }
    });

    const debouncedMutate = useDebouncedCallback(
        (next: number[]) => {
            mutation.mutate({ requestBody: next });
        },
        delay,
        { leading: false, trailing: true }
    );

    return debouncedMutate;
}

type GroupedCinemas = Record<
    number,
    {
        city: CityPublic,
        cinemasForCity: CinemaPublic[],
    }
>

function groupCinemasByCity(cinemas: CinemaPublic[]) {
    return cinemas.reduce((acc, cinema) => {
        const cityId = cinema.city.id;
        if (!acc[cityId]) {
            acc[cityId] = {
                city: cinema.city,
                cinemasForCity: []
            }
        }
        acc[cinema.city.id].cinemasForCity.push(cinema)
        return acc
    }, {} as GroupedCinemas)
}


const Filters = () => {
    const { data: cinemas } = useFetchCinemas();
    const groupedCinemas = groupCinemasByCity(cinemas || []);
    const { data: selectedCinemaIds } = useFetchSelectedCinemas();
    const [selectedCinemas, setSelectedCinemas] = useState<number[]>([]);
    const [initialized, setInitialized] = useState(false);
    const debouncedMutate = useDebouncedCinemaMutation(500);

    useEffect(() => {
        if (selectedCinemaIds !== undefined && !initialized) {
            setSelectedCinemas(selectedCinemaIds);
            setInitialized(true);
        }
    }, [selectedCinemaIds]);

    const handleToggle = (cinemaId: number, select: boolean) => {
        setSelectedCinemas((prev) => {
            const next = select
                ? [...new Set([...prev, cinemaId])]
                : prev.filter(id => id !== cinemaId);

            debouncedMutate(next);
            return next;
        });
    }

    if (cinemas === undefined || selectedCinemaIds === undefined) {
        return (
            <FilterButton
                disabled={true}
            />
        )
    }


    return (
        <Dialog.Root
            size="cover"
        >
            <Dialog.Trigger asChild>
                <FilterButton />
            </Dialog.Trigger>
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <Dialog.Title>Filters</Dialog.Title>
                            <Dialog.CloseTrigger asChild>
                                <CloseButton size="sm" />
                            </Dialog.CloseTrigger>
                        </Dialog.Header>
                        <Dialog.Body>
                            {
                                Object.values(groupedCinemas).map(({ city, cinemasForCity }) => (
                                    <Box key={city.id} mb={4}>
                                        <Heading as="h3" size="md">
                                            {city.name}:
                                        </Heading>
                                        { cinemasForCity.map((cinema) => (
                                            <CinemaToggle
                                                key={cinema.id}
                                                cinema={cinema}
                                                enabled={selectedCinemas.includes(cinema.id)}
                                                handleToggle={handleToggle}
                                            />
                                        )) }
                                    </Box>
                                ))
                            }
                        </Dialog.Body>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    );
}

export default Filters;
