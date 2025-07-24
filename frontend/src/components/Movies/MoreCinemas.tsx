import { Popover, Badge, Portal, For } from "@chakra-ui/react";
import type { CinemaPublic } from "@/client";
import CinemaBadge from "@/components/Common/CinemaBadge";

type MoreCinemasProps = {
    cinemas: CinemaPublic[];
    visibleCount: number;
    morePos: number;
    moreRef: React.RefObject<HTMLDivElement>;
};

const MoreCinemas = ({
    cinemas,
    visibleCount,
    morePos,
    moreRef
}: MoreCinemasProps) => {

    const hidden = cinemas.length - visibleCount;

    return (
        <Popover.Root>
            <Popover.Trigger asChild>
                <Badge
                    m={0.5}
                    variant={"surface"}
                    colorPalette={"grey"}
                    size={"sm"}
                    position={"absolute"}
                    left={`${morePos}px`}
                    ref={moreRef}
                    visibility={hidden > 0 ? "visible" : "hidden"}
                >
                    {`+${hidden} more`}
                </Badge>
            </Popover.Trigger>
            <Portal>
                <Popover.Positioner>
                    <Popover.Content maxW={"max-content"} >
                        <Popover.Arrow/>
                        <Popover.Body
                            p={1.5}
                            display="flex"
                            flexWrap="wrap"
                            justifyContent={"center"}
                        >
                            <For each={cinemas.slice(visibleCount)}>
                                {(cinema) =>
                                    <CinemaBadge
                                        key={cinema.id}
                                        cinema={cinema}
                                    />
                                }
                            </For>
                        </Popover.Body>
                    </Popover.Content>
                </Popover.Positioner>
            </Portal>
        </Popover.Root>
    );
}

export default MoreCinemas;
