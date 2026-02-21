/**
 * Single-movie detail feature component: Movie Page.
 */
import { MoviesService, type MoviesReadMovieResponse } from "shared";
import { useQuery } from "@tanstack/react-query";
import MovieTitle from "@/components/Movie/MovieTitle";
import MoviePoster from "@/components/Movie/MoviePoster";
import MovieLinks from "@/components/Movie/MovieLinks";
import { Showtimes } from "@/components/Movie/Showtimes";
import { Flex, Center, Spinner, Spacer, Box } from "@chakra-ui/react";
import Sidebar from "@/components/Common/Sidebar";
import TopBar from "@/components/Common/TopBar";
import Page from "@/components/Common/Page";
import { Route } from "@/routes/movie.$movieId";
import OriginalTitle from "./OriginalTitle";
import ReleaseYear from "./ReleaseYear";
import Directors from "./Directors";
import { Dialog, Portal, Button, HStack, VStack, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShowtimesService, type ShowtimesUpdateShowtimeSelectionResponse } from "shared";
import type { ShowtimeInMovieLoggedIn, GoingStatus } from "shared";
import type { ShowtimeSelectionTogglePayload } from "@/types";
import type { MovieSummaryLoggedIn } from "shared";
import Filters from "@/components/Movies/Filters";
import UserMenu from "@/components/Common/UserMenu";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";
import { useFetchFriends } from "shared/hooks/useFetchFriends";
import { DateTime } from "luxon";

type FriendPingAvailability = "eligible" | "pinged" | "going" | "interested";

type UpdateCacheData = {
    movieId: number;
    showtimeId: number;
    newValue: GoingStatus;
}

type InfiniteMoviesData = {
    pages: MovieSummaryLoggedIn[][];
    pageParams: unknown[];
};


const MoviePage = () => {
    // Read flow: prepare derived values/handlers first, then return component JSX.
    const queryClient = useQueryClient();
    const [selectedShowtime, setSelectedShowtime] = useState<ShowtimeInMovieLoggedIn | null>(null);
    const [pingListOpen, setPingListOpen] = useState(false);
    const [pingedFriendIds, setPingedFriendIds] = useState<string[]>([]);
    const [selectedDays, setSelectedDays] = useState<Date[]>([]);
    const params = Route.useParams();
    const { movieId } = params as { movieId: string };
    const movieIdNumber = Number(movieId);
    // Data hooks keep this module synced with backend data and shared cache state.
    const { data: selectedCinemaIds, isLoading: isLoadingSelectedCinemas } = useFetchSelectedCinemas();
    const { data: friends } = useFetchFriends({ enabled: !!selectedShowtime });
    const selectedDayFilters = selectedDays.map((day) => DateTime.fromJSDate(day).toISODate() || "");
    const shouldWaitForCinemaSelection = isLoadingSelectedCinemas && selectedCinemaIds === undefined;

    // Include cinema/day filters in the query key so cached data lines up with active filters.
    const { data, isLoading, isFetching } = useQuery<MoviesReadMovieResponse, Error>({
        queryKey: ["movie", movieIdNumber, selectedCinemaIds, selectedDayFilters],
        enabled: Number.isFinite(movieIdNumber) && movieIdNumber > 0 && !shouldWaitForCinemaSelection,
        queryFn: () =>
            MoviesService.readMovie({
                id: movieIdNumber,
                selectedCinemaIds,
                days: selectedDayFilters,
            }),
    });

    const title = data?.title || "";
    const showtimes = data?.showtimes || [];
    const posterUrl = data?.poster_link || "https://via.placeholder.com/300x450.png?text=No+Poster+Available"
    const letterboxdSlug = data?.letterboxd_slug || "";
    const letterboxdSearchQuery = title
        ? `${title}${data?.release_year ? ` ${data.release_year}` : ""}`
        : "";
    const letterboxdSearchUrl = letterboxdSearchQuery
        ? `https://letterboxd.com/search/${encodeURIComponent(letterboxdSearchQuery)}/`
        : null;
    const letterboxdUrl = letterboxdSlug
        ? `https://letterboxd.com/film/${letterboxdSlug}`
        : letterboxdSearchUrl;

    const isMovieLoading = shouldWaitForCinemaSelection || (isLoading && !data);
    const handleDaysChange = (days: Date[]) => setSelectedDays(days);
    useEffect(() => {
        if (!selectedShowtime) {
            setPingListOpen(false);
            setPingedFriendIds([]);
        }
    }, [selectedShowtime]);

    const friendsGoingIds = useMemo(() => {
        if (!selectedShowtime) {
            return new Set<string>();
        }
        return new Set<string>(selectedShowtime.friends_going.map((friend) => friend.id));
    }, [selectedShowtime]);
    const friendsInterestedIds = useMemo(() => {
        if (!selectedShowtime) {
            return new Set<string>();
        }
        return new Set<string>(
            selectedShowtime.friends_interested.map((friend) => friend.id),
        );
    }, [selectedShowtime]);
    const friendsForPing = useMemo(() => {
        const availabilityRank: Record<FriendPingAvailability, number> = {
            eligible: 0,
            pinged: 1,
            interested: 2,
            going: 3,
        };
        return (friends ?? [])
            .map((friend) => {
                const isGoing = friendsGoingIds.has(friend.id);
                const isInterested = friendsInterestedIds.has(friend.id);
                const alreadyPinged = pingedFriendIds.includes(friend.id);
                const availability: FriendPingAvailability = isGoing
                    ? "going"
                    : isInterested
                        ? "interested"
                        : alreadyPinged
                            ? "pinged"
                            : "eligible";
                const label = friend.display_name?.trim() || "Friend";
                return {
                    id: friend.id,
                    label,
                    initial: label.charAt(0).toUpperCase(),
                    availability,
                };
            })
            .sort((left, right) => {
                const rankDifference =
                    availabilityRank[left.availability] - availabilityRank[right.availability];
                if (rankDifference !== 0) {
                    return rankDifference;
                }
                return left.label.localeCompare(right.label);
            });
    }, [friends, friendsGoingIds, friendsInterestedIds, pingedFriendIds]);

    // Keep movie details and movie-list caches in sync after a showtime status change.
    const updateCacheAfterShowtimeToggle = ({ movieId, showtimeId, newValue }: UpdateCacheData) => {
        queryClient.invalidateQueries({ queryKey: ["showtimes"] });

        // update the cache in the movie details page
        queryClient.setQueriesData(
            { queryKey: ["movie", movieId] },
            (oldData: MoviesReadMovieResponse | undefined) => {
                if (!oldData || !oldData.showtimes) return oldData;

                const newShowtimes = oldData.showtimes.map((s) =>
                    s.id === showtimeId ? { ...s, going: newValue } : s
                );

                return {
                    ...oldData,
                    showtimes: newShowtimes,
                };
            }
        );

        // new showtimes with going flag updated
        const updatedShowtimes = showtimes.map((s) =>
            s.id === showtimeId ? { ...s, going: newValue } : s
        );
        const going = updatedShowtimes.some((s) => s.going); // true if going to any showtime

        const movieQueries = queryClient.getQueriesData<InfiniteMoviesData>({ queryKey: ['movies'] });
        movieQueries.forEach(([queryKey, oldData]) => {
            if (!oldData) return;

            const newPages = oldData.pages.map((page) => {
                const newResults = page.map((movie) =>
                    movie.id === movieId ? { ...movie, going: going } : movie
                );
                return newResults;
            });

            queryClient.setQueryData(queryKey, {
                ...oldData,
                pages: newPages,
            });
        });
    }

    const { mutate: handleToggle } = useMutation<ShowtimesUpdateShowtimeSelectionResponse, Error, ShowtimeSelectionTogglePayload>({
        mutationFn: ({ showtimeId, going_status }) => ShowtimesService.updateShowtimeSelection({
            showtimeId, requestBody: {
                going_status: going_status
            }
        }),
        onSuccess: (data) => {
            console.log("Showtime toggled", data);
            updateCacheAfterShowtimeToggle({
                movieId: data.movie.id,
                showtimeId: data.id,
                newValue: data.going
            });
        },
        onError: (error) => {
            console.error("Error toggling showtime:", error);
        }
    });
    const { mutate: handlePingFriend, isPending: isPingingFriend } = useMutation<
        { message: string },
        Error,
        { showtimeId: number; friendId: string }
    >({
        mutationFn: ({ showtimeId, friendId }) =>
            ShowtimesService.pingFriendForShowtime({
                showtimeId,
                friendId,
            }),
        onSuccess: (_message, variables) => {
            setPingedFriendIds((previous) =>
                previous.includes(variables.friendId) ? previous : [...previous, variables.friendId]
            );
        },
        onError: (error) => {
            console.error("Error pinging friend:", error);
        },
    });

    // Dialog buttons call into the mutation with the selected showtime row.
    const handleToggleShowtime = (going: GoingStatus) => {
        if (!selectedShowtime) return;
        handleToggle({ showtimeId: selectedShowtime.id, going_status: going });
    }
    // Render/output using the state and derived values prepared above.
    return (
        <>
            {selectedShowtime && (
                <Dialog.Root lazyMount placement="center"
                    open={true} onOpenChange={(e) => {
                        if (!e.open) {
                            setSelectedShowtime(null);
                            setPingListOpen(false);
                            setPingedFriendIds([]);
                        }
                    }}
                >
                    <Portal>
                        <Dialog.Backdrop
                        />
                        <Dialog.Positioner
                        >
                            <Dialog.Content p={2} maxW={600} transform="translateY(-6vh)">
                                <Dialog.Header>
                                    <Dialog.Title fontSize="md">
                                        {/* {`Are you going the ${formattedTime} showtime of ${title} on ${formattedDate} at ${cinema.name}?`} */}
                                    </Dialog.Title>
                                </Dialog.Header>
                                <Dialog.Body>
                                    <HStack gap={3} justify={"center"} flexWrap={{ base: "wrap", md: "nowrap" }}>
                                        <Dialog.ActionTrigger asChild>
                                            <Button
                                                maxW={150}
                                                variant={selectedShowtime.going == "GOING" ? "solid" : "surface"}
                                                colorScheme="green"
                                                w="100%"
                                                onClick={() => handleToggleShowtime("GOING")}
                                            >
                                                I'm Going!
                                            </Button>
                                        </Dialog.ActionTrigger>
                                        <Dialog.ActionTrigger asChild>
                                            <Button
                                                maxW={150}
                                                variant={selectedShowtime.going == "INTERESTED" ? "solid" : "surface"}
                                                colorPalette="orange"
                                                w="100%"
                                                onClick={() => handleToggleShowtime("INTERESTED")}
                                            >
                                                I'm Interested
                                            </Button>
                                        </Dialog.ActionTrigger>
                                        <Dialog.ActionTrigger asChild>
                                            <Button
                                                maxW={150}
                                                variant={"surface"}
                                                colorPalette={"red"}
                                                w="100%"
                                                onClick={() => handleToggleShowtime("NOT_GOING")}
                                            >
                                                I'm Not Going
                                            </Button>
                                        </Dialog.ActionTrigger>
                                    </HStack>
                                    <VStack align="stretch" gap={2} mt={4}>
                                        <Button
                                            variant="surface"
                                            onClick={() => setPingListOpen((previous) => !previous)}
                                            disabled={isPingingFriend}
                                        >
                                            {pingListOpen ? "Hide friends" : "Ping friends"}
                                        </Button>
                                        {pingListOpen ? (
                                            <Box
                                                borderWidth="1px"
                                                borderColor="border.muted"
                                                borderRadius="md"
                                                bg="bg.muted"
                                                p={2}
                                            >
                                                <Text color="fg.muted" fontSize="xs" fontWeight="700" mb={2}>
                                                    Friends ({friendsForPing.length})
                                                </Text>
                                                {friendsForPing.length === 0 ? (
                                                    <Text color="fg.muted" fontSize="sm">
                                                        No friends yet.
                                                    </Text>
                                                ) : (
                                                    <VStack
                                                        align="stretch"
                                                        gap={2}
                                                        maxH="16rem"
                                                        overflowY="auto"
                                                        pr={1}
                                                    >
                                                        {friendsForPing.map((friend) => {
                                                            const canPing =
                                                                friend.availability === "eligible" && !isPingingFriend;
                                                            const statusLabel =
                                                                friend.availability === "going"
                                                                    ? "Going"
                                                                    : friend.availability === "interested"
                                                                        ? "Interested"
                                                                        : friend.availability === "pinged"
                                                                            ? "Pinged"
                                                                            : "Ready";
                                                            return (
                                                                <Flex
                                                                    key={friend.id}
                                                                    alignItems="center"
                                                                    justifyContent="space-between"
                                                                    gap={3}
                                                                    borderWidth="1px"
                                                                    borderColor="border.muted"
                                                                    borderRadius="md"
                                                                    bg="bg.panel"
                                                                    px={2}
                                                                    py={2}
                                                                >
                                                                    <Flex alignItems="center" gap={2} minW={0}>
                                                                        <Flex
                                                                            w="26px"
                                                                            h="26px"
                                                                            alignItems="center"
                                                                            justifyContent="center"
                                                                            borderRadius="full"
                                                                            borderWidth="1px"
                                                                            borderColor="border.muted"
                                                                            bg="bg.muted"
                                                                            flexShrink={0}
                                                                        >
                                                                            <Text fontSize="xs" fontWeight="700">
                                                                                {friend.initial || "F"}
                                                                            </Text>
                                                                        </Flex>
                                                                        <Box minW={0}>
                                                                            <Text
                                                                                fontSize="sm"
                                                                                overflow="hidden"
                                                                                textOverflow="ellipsis"
                                                                                whiteSpace="nowrap"
                                                                            >
                                                                                {friend.label}
                                                                            </Text>
                                                                            <Text color="fg.muted" fontSize="xs">
                                                                                {statusLabel}
                                                                            </Text>
                                                                        </Box>
                                                                    </Flex>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="surface"
                                                                        disabled={!canPing}
                                                                        onClick={() =>
                                                                            selectedShowtime &&
                                                                            handlePingFriend({
                                                                                showtimeId: selectedShowtime.id,
                                                                                friendId: friend.id,
                                                                            })
                                                                        }
                                                                    >
                                                                        {friend.availability === "eligible"
                                                                            ? "Ping"
                                                                            : statusLabel}
                                                                    </Button>
                                                                </Flex>
                                                            );
                                                        })}
                                                    </VStack>
                                                )}
                                            </Box>
                                        ) : null}
                                    </VStack>
                                </Dialog.Body>
                            </Dialog.Content>
                        </Dialog.Positioner>
                    </Portal>
                </Dialog.Root>
            )}
            <Flex>
                <Sidebar />
                <TopBar>
                    <Filters selectedDays={selectedDays} handleDaysChange={handleDaysChange} />
                    <Spacer />
                    <UserMenu />
                </TopBar>
            </Flex>
            <Page>
                {isMovieLoading ? (
                    <Center h="50vh">
                        <Spinner size="xl" />
                    </Center>
                ) : (
                    <>
                        <Flex gap={4}>
                            {letterboxdUrl ? (
                                <a
                                    href={letterboxdUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`Open ${title} on Letterboxd`}
                                    style={{ display: "inline-block" }}
                                >
                                    <MoviePoster posterUrl={posterUrl} />
                                </a>
                            ) : (
                                <MoviePoster posterUrl={posterUrl} />
                            )}
                            <Flex flexDirection={"column"} flex={1} minW={0} justifyContent={"top"}>
                                <Flex alignItems={"baseline"} gap={4} minW={0} flexWrap={"wrap"}>
                                    <MovieTitle title={title} />
                                    <ReleaseYear releaseYear={data?.release_year || null} />
                                    <OriginalTitle originalTitle={data?.original_title || null} />
                                </Flex>
                                <Directors directors={data?.directors || null} />
                                <MovieLinks
                                    letterboxd={letterboxdUrl ?? undefined}
                                />
                            </Flex>
                        </Flex>

                        <Showtimes showtimes={showtimes} setSelectedShowtime={setSelectedShowtime} />
                        {isFetching ? (
                            <Center mt={4}>
                                <Spinner />
                            </Center>
                        ) : null}
                    </>
                )}
            </Page>
        </>
    );
};

export default MoviePage;
