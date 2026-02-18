/**
 * User settings feature component: Delete Account.
 */
import { Container, Heading, Text } from "@chakra-ui/react"

import DeleteConfirmation from "./DeleteConfirmation"

const DeleteAccount = () => {
  // Read flow: prepare derived values/handlers first, then return component JSX.
  return (
    <Container maxW="full">
      <Heading size="sm" py={4}>
        Delete Account
      </Heading>
      <Text>
        Permanently delete your data and everything associated with your
        account.
      </Text>
      <DeleteConfirmation />
    </Container>
  )
}
export default DeleteAccount
