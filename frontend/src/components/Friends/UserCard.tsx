import type { UserWithFriendStatus } from "@/client"
import { Flex, Text, Badge, IconButton, Spacer, Icon } from "@chakra-ui/react"
import { IoMdRemove, IoIosCheckmark } from "react-icons/io";
import { LiaTimesSolid, LiaPlusSolid } from "react-icons/lia";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    FriendsService,
    FriendsRemoveFriendData,
    FriendsAcceptFriendRequestData,
    FriendsSendFriendRequestData,
    FriendsCancelFriendRequestData
} from "@/client";

type UserCardProps = {
    user: UserWithFriendStatus;
};


const UserCard = ({ user }: UserCardProps) => {

    const queryClient = useQueryClient();

    let badge, button, secondButton, bgColor;

    const removeFriendMutation = useMutation({
        mutationFn: (data: FriendsRemoveFriendData) => FriendsService.removeFriend(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["users"] });
        },
        onError: (error) => {
            console.error("Error removing friend:", error);
        }
    });

    const sendFriendRequestMutation = useMutation({
        mutationFn: (data: FriendsSendFriendRequestData) => FriendsService.sendFriendRequest(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["users"] });
        },
        onError: (error) => {
            console.error("Error sending friend request:", error);
        }
    });

    const acceptFriendRequestMutation = useMutation({
        mutationFn: (data: FriendsAcceptFriendRequestData) => FriendsService.acceptFriendRequest(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["users"] });
        },
        onError: (error) => {
            console.error("Error accepting friend request:", error);
        }
    });

    const cancelFriendRequestMutation = useMutation({
        mutationFn: (data: FriendsCancelFriendRequestData) => FriendsService.cancelFriendRequest(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["users"] });
        },
        onError: (error) => {
            console.error("Error cancelling friend request:", error);
        }
    });

    if (user.is_friend) {
        bgColor = "green.100";
        badge = (
            <Badge
                colorPalette="green"
                variant={"solid"}
                fontSize="0.8em"
            >
                Friend
            </Badge>
        )
        button = (
            <IconButton
                aria-label="Remove friend"
                bg={"red.500"}
                _hover={{ bg: "red.600"}}
                rounded={"full"}
                size="xs"
                onClick={() => removeFriendMutation.mutate({ friendId: user.id })}
            >
                <Icon as={IoMdRemove} boxSize={6}></Icon>
            </IconButton>
        )
    } else if (user.received_request) {
        badge = (
            bgColor = "blue.100",
            <Badge
                colorPalette="blue"
                variant={"solid"}
                fontSize="0.8em"
            >
                Sent you a friend request
            </Badge>
        )
        button = (
            <IconButton
                aria-label="Decline friend request"
                bg={"red.500"}
                _hover={{ bg: "red.600"}}
                rounded={"full"}
                size="xs"
            >
                <Icon as={LiaTimesSolid} boxSize={5}></Icon>
            </IconButton>
        )
        secondButton = (
            <IconButton
                aria-label="Accept friend request"
                bg={"green.500"}
                _hover={{ bg: "green.600"}}
                rounded={"full"}
                size="xs"
                onClick={() => acceptFriendRequestMutation.mutate({ senderId: user.id })}
            >
                <Icon as={IoIosCheckmark} boxSize={7}></Icon>
            </IconButton>
        )
    } else if (user.sent_request) {
        bgColor = "yellow.100";
        badge = (
            <Badge
                colorPalette="yellow"
                variant={"solid"}
                fontSize="0.8em"
            >
                Request sent
            </Badge>
        )
        button = (
            <IconButton
                aria-label="Cancel friend request"
                bg={"red.500"}
                _hover={{ bg: "red.600"}}
                rounded={"full"}
                size="xs"
                onClick={() => cancelFriendRequestMutation.mutate({ receiverId: user.id })}
            >
                <Icon as={LiaTimesSolid} boxSize={5}></Icon>
            </IconButton>
        )
    } else {
        bgColor = "gray.50";
        button = (
            <IconButton
                aria-label="Add friend"
                bg={"green.500"}
                _hover={{ bg: "green.600"}}
                rounded={"full"}
                size="xs"
                onClick={() => sendFriendRequestMutation.mutate({ receiverId: user.id })}
            >
                <Icon as={LiaPlusSolid} boxSize={6}></Icon>
            </IconButton>
        )
        secondButton = null;
    }




    return (
        <Flex
            borderWidth="1px"
            borderRadius="md"
            p={4}
            mb={2}
            // _hover={{ bg: "gray.50", cursor: "pointer" }}
            display="flex"
            alignItems="center"
            gap={4}
            bg={bgColor || "white"}
        >
            <Text>
                {user.display_name}
            </Text>
            {
                (user.letterboxd_username)
                ? <Text
                    fontSize="0.8em"
                    color="gray.500"
                >
                    ({user.letterboxd_username})
                </Text>
                : ""
            }
            { badge }
            <Spacer />
            { button }
            { secondButton }
        </Flex>
    );
}

export default UserCard;
