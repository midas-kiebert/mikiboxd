/**
 * Shared web layout/presentation component: My Button.
 */
import { Button } from "@chakra-ui/react"


const MyButton = ({
    children,
    ...props
}: React.ComponentProps<typeof Button>) => {
    // Read flow: prepare derived values/handlers first, then return component JSX.
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
