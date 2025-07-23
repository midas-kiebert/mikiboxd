import Badge from "@/components/Common/Badge";

interface FriendBadgeProps {
    display_name: string;
    url: string;
}

const CinemaBadge = ({ display_name, url } : FriendBadgeProps) => {

    return (
        <Badge
            text={display_name}
            url={url || "#"}
            textSize="12px"
            bgColor="gray.200"
            textColor="black"
        />
    );
};

export default CinemaBadge;
