import { Tabs } from '@chakra-ui/react';
import { FaUserFriends, FaUserPlus } from 'react-icons/fa';
import AddFriends from './AddFriends/AddFriends';


const FriendTabs = () => {
    return (
        <Tabs.Root defaultValue="My Friends">
            <Tabs.List>
                <Tabs.Trigger value="My Friends">
                    <FaUserFriends />
                    My Friends
                </Tabs.Trigger>
                <Tabs.Trigger value="Add Friends">
                    <FaUserPlus />
                    Add Friends
                </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="My Friends">
                My Friends
            </Tabs.Content>
            <Tabs.Content value="Add Friends">
                <AddFriends/>
            </Tabs.Content>

        </Tabs.Root>
    );
}

export default FriendTabs;
