import { Button } from "@chakra-ui/react"


const MyButton = ({
    children,
    ...props
}: React.ComponentProps<typeof Button>) => {
    return (
        <Button
            colorPalette="green"
            variant="solid"
            size="md"
            {...props}
        >
            {children}
        </Button>
    );
}

export default MyButton;
