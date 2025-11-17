import MyButton from '@/components/Common/MyButton';
import { FaFilter } from 'react-icons/fa';
import { Box, Text } from '@chakra-ui/react';

const FilterButton = (props : any) => {

    return (
        <MyButton {...props}>
            <Box>
                <FaFilter/>
            </Box>
            <Text display={{ base: 'none', md: 'inline' }}>Filters</Text>
        </MyButton>
    );
}

export default FilterButton;
