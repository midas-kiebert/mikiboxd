import { Text, VStack } from "@chakra-ui/react";
import days from "dayjs"
import type { ShowtimeLoggedIn } from "@/client";


type DatetimeCardProps = {
    showtime: ShowtimeLoggedIn;
}

const DatetimeCard = ({ showtime }: DatetimeCardProps) => {
    const datetime = new Date(showtime.datetime);
    const day = days(datetime).format('D');
    const month = days(datetime).format('MMMM');
    const time = days(datetime).format('HH:mm');
    const weekday = days(datetime).format('ddd');

    return (
        <VStack
            gap={0}
            align="center"
            justify="center"
            width="80px"
            height="100%"
        >
            <Text
                fontSize="xs"
                color="gray.500"
                textTransform="uppercase"
                lineHeight={"3"}
            >
                {weekday}
            </Text>
            <Text
                fontSize="3xl"
                fontWeight="bold"
                lineHeight={"0.7"}
                color="green.700"
            >
                {day}
            </Text>
            <Text
                fontSize="xs"
                color="gray.600"
            >
                {month}
            </Text>
            <Text
                fontSize="xl"
                color="gray.800"
                fontWeight="semibold"
                lineHeight={"1.2"}
                fontFamily={"monospace"}
            >
                {time}
            </Text>
        </VStack>
    );
}

export default DatetimeCard;
