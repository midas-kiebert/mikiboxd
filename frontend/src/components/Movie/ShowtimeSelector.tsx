import {
    ShowtimesService,
    ShowtimesSelectShowtimeResponse,
    ShowtimesDeleteShowtimeSelectionResponse,
} from "@/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@chakra-ui/react";
import useIsShowtimeSelected from "@/hooks/useIsShowtimeSelected";

type ShowtimeSelectorProps = {
    id: number;
}

const ShowtimeSelector = ({ id } : ShowtimeSelectorProps) => {
    const { isSelected } = useIsShowtimeSelected(id);

    const queryClient = useQueryClient();
    const selectMutation = useMutation<ShowtimesSelectShowtimeResponse, Error, { id: number }>({
        mutationFn: ({ id }) => ShowtimesService.selectShowtime({ showtimeId: id }),
        onSuccess: (data) => {
            console.log("Showtime selected:", data);
            queryClient.invalidateQueries({ queryKey: ["selectShowtime"] })
        },
        onError: (error) => {
            console.error("Error selecting showtime:", error);
        }
    });
    const deselectMutation = useMutation<ShowtimesDeleteShowtimeSelectionResponse, Error, { id: number }>({
        mutationFn: ({ id }) => ShowtimesService.deleteShowtimeSelection({ showtimeId: id }),
        onSuccess: (data) => {
            console.log("Showtime deselected:", data);
            queryClient.invalidateQueries({ queryKey: ["selectShowtime"] })
        },
        onError: (error) => {
            console.error("Error deleting showtime:", error);
        }
    });


    const handleSelect = () => {
        if (isSelected) {
            deselectMutation.mutate({ id });
        } else {
            selectMutation.mutate({ id });
        }
    }

    return (
        <>
            <Button
                onClick={handleSelect}
            >
                {isSelected ? "Cancel" : "I'm Going!"}
            </Button>
        </>
    )
}

export default ShowtimeSelector;