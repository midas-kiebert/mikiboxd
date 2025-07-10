import { TestService, TestMyTestResponse } from "@/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@chakra-ui/react";

const MyButton = () => {

    // how do i make it so it fetches when i press the button?


    const { data, refetch, isFetching, isFetched } = useQuery<TestMyTestResponse, Error>({
        queryKey: ["myTest"],
        queryFn: TestService.myTest,
        enabled: false
    });

    return (
        <div>
        <Button onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "Fetching Data..." : "Fetch Test Data!"}
        </Button>
        <div>
            <p>{isFetched ? data?.message: "Not fetched yet"}</p>
        </div>
        </div>
    )
}

export default MyButton;