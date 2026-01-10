import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { Box } from "@chakra-ui/react";

type DayFilterProps = {
    selectedDays: Date[];
    onChange: (days: Date[]) => void;
};


export function DayFilter({ selectedDays, onChange }: DayFilterProps) {
    return (
        <Box>
            <DayPicker
                mode="multiple"
                disabled={{ before: new Date() }}
                selected={selectedDays}
                onSelect={(days) => {
                    onChange(days || []);
                }
                }
            />
        </Box>
    );
}
