"""
IP Verification Service
=======================
Checks whether a student's IP is in the same subnet as the teacher's
locked IP, or within the configured allowed campus subnets.
"""

import ipaddress
from fastapi import Request, HTTPException
from core.config import get_settings

settings = get_settings()


def get_client_ip(request: Request) -> str:
    """
    Extract real client IP — respects X-Forwarded-For for reverse proxies
    (nginx, Render, Railway, etc.).
    """
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host


def _parse_subnets(subnet_str: str) -> list[ipaddress.IPv4Network]:
    subnets = []
    for s in subnet_str.split(","):
        s = s.strip()
        if s:
            try:
                subnets.append(ipaddress.IPv4Network(s, strict=False))
            except ValueError:
                pass
    return subnets


def ip_in_subnet(ip: str, subnet: str) -> bool:
    """Check if an IP falls within a given subnet (CIDR notation)."""
    try:
        addr    = ipaddress.IPv4Address(ip)
        network = ipaddress.IPv4Network(subnet, strict=False)
        return addr in network
    except ValueError:
        return False


def same_network(ip_a: str, ip_b: str, prefix_len: int = 24) -> bool:
    """
    Check if two IPs are on the same /24 (or given prefix) network —
    used to compare student IP with teacher's locked IP.
    """
    try:
        net_a = ipaddress.IPv4Interface(f"{ip_a}/{prefix_len}").network
        net_b = ipaddress.IPv4Interface(f"{ip_b}/{prefix_len}").network
        return net_a == net_b
    except ValueError:
        return False


def verify_student_ip(
    student_ip: str,
    teacher_ip: str,
    raise_on_fail: bool = True,
) -> tuple[bool, str]:
    """
    Full IP verification logic:
    1. Check student is on same /24 as teacher
    2. Check student is within any allowed campus subnet

    Returns (is_allowed, reason_string).
    If raise_on_fail=True, raises HTTPException on failure.
    """
    # Rule 1 — same network as teacher
    if same_network(student_ip, teacher_ip):
        return True, "Same network as teacher"

    # Rule 2 — within allowed campus subnets
    allowed_subnets = _parse_subnets(settings.allowed_subnets)
    for subnet in allowed_subnets:
        try:
            if ipaddress.IPv4Address(student_ip) in subnet:
                return True, f"Within campus subnet {subnet}"
        except ValueError:
            continue

    # Failed both checks
    reason = (
        f"Your IP ({student_ip}) is not on the campus network. "
        f"Please connect to the campus Wi-Fi or LAN and try again."
    )
    if raise_on_fail:
        raise HTTPException(status_code=403, detail=reason)

    return False, reason