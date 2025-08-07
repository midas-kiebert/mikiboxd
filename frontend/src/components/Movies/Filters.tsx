import FilterButton from "./FilterButton";
import { CloseButton, Dialog, Portal } from '@chakra-ui/react'
import CinemaToggle from "../Common/CinemaToggle";
import {useFetchCinemas} from "@/hooks/useFetchCinemas";
import { useFetchSelectedCinemas } from "@/hooks/useFetchSelectedCinemas";
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MeService, MeSetCinemaSelectionsData } from "@/client";
import { useDebounce } from "use-debounce";

const Filters = () => {
    const queryClient = useQueryClient();
    const { data: cinemas } = useFetchCinemas();
    const { data: selectedCinemaIds } = useFetchSelectedCinemas();
    const [selectedCinemas, setSelectedCinemas] = useState<number[]>([]);
    const [initialized, setInitialized] = useState(false);

    useEffect(() => {
        if (selectedCinemaIds !== undefined && !initialized) {
            setSelectedCinemas(selectedCinemaIds);
            setInitialized(true);
        }
    }, [selectedCinemaIds]);

    // Mutation to update selected cinemas
    const setCinemaSelectionsMutation = useMutation({
        mutationFn: (data: MeSetCinemaSelectionsData) => {
            return MeService.setCinemaSelections(data);
        },
        onSuccess: () => {
            queryClient.setQueryData(["user", "cinema_selections"], selectedCinemas);
            queryClient.invalidateQueries({ queryKey: ["movies"] });
        },
    });

    // Debounced function to update selected cinemas
    const [debouncedSelectedCinemas] = useDebounce(selectedCinemas, 500);

    useEffect(() => {
        if (!initialized) return;
        setCinemaSelectionsMutation.mutate({ requestBody: debouncedSelectedCinemas });
    }, [debouncedSelectedCinemas]);

    const handleToggle = (cinemaId: number, select: boolean) => {
        setSelectedCinemas((prev) => {
            if (select) {
                return [...prev, cinemaId];
            } else {
                return prev.filter(id => id !== cinemaId);
            }
        });
    }

    if (!cinemas || !selectedCinemaIds) {
        return null; // or a loading spinner
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
                                cinemas.map((cinema) => (
                                    <CinemaToggle
                                        key={cinema.id}
                                        cinema={cinema}
                                        enabled={selectedCinemas.includes(cinema.id)}
                                        handleToggle={handleToggle}
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
