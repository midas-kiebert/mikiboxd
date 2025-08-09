import FilterButton from "./FilterButton";
import { CloseButton, Dialog, Portal } from '@chakra-ui/react'
import {useFetchCinemas} from "@/hooks/useFetchCinemas";
import { useFetchSelectedCinemas } from "@/hooks/useFetchSelectedCinemas";
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MeService, MeSetCinemaSelectionsData } from "@/client";
import { useDebouncedCallback } from "use-debounce";
import type { CinemaPublic, CityPublic } from "@/client";
import CityCinemas from "./CityCinemas";


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

    const handleToggle = (cinemaId: number) => {
        const select = !selectedCinemas.includes(cinemaId);
        setSelectedCinemas((prev) => {
            const next = select
                ? [...new Set([...prev, cinemaId])]
                : prev.filter(id => id !== cinemaId);

            debouncedMutate(next);
            return next;
        });
    }

    const handleToggleCity = (cityId: number) => {
        const cityCinemas = groupedCinemas[cityId]?.cinemasForCity || [];
        const allSelected = cityCinemas.every(cinema => selectedCinemas.includes(cinema.id));

        setSelectedCinemas((prev) => {
            const next = allSelected
                ? selectedCinemas.filter(id => !cityCinemas.some(cinema => cinema.id === id))
                : [...new Set([...prev, ...cityCinemas.map(cinema => cinema.id)])];

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
            scrollBehavior={"inside"}
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
                                    <CityCinemas
                                        key={city.id}
                                        city={city}
                                        cinemasForCity={cinemasForCity}
                                        selectedCinemas={selectedCinemas}
                                        handleToggle={handleToggle}
                                        handleToggleCity={handleToggleCity}
                                    />
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
