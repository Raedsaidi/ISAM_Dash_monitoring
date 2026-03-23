from datetime import timedelta, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import or_

from app.core.config import settings
from app.core.db import get_db
from app.core.security import (
    create_access_token,
    get_password_hash,
    verify_password,
    get_current_user,
    require_admin,
    create_refresh_token_for_user,
    get_stored_refresh_token,
    revoke_refresh_token,
)
from app.models.auth import (
    Token,
    UserCreateSelf,
    AdminUserCreate,
    AdminUserUpdate,
    UserRead,
    UserAdminRead,
    UserList,
    RefreshTokenRequest,
)
from app.models.user import User, UserRole, UserPort
from app.models.refresh_token import RefreshToken

router = APIRouter(prefix="/auth", tags=["Auth"])


# ----- Self-register (visiteur) -----

@router.post("/register-self", response_model=UserRead, status_code=201)
def register_self(
    user_in: UserCreateSelf,
    db: Session = Depends(get_db),
):
    existing = db.query(User).filter(User.username == user_in.username).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ce nom d'utilisateur existe déjà.",
        )

    existing_email = db.query(User).filter(User.email == user_in.email).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cet email est déjà utilisé.",
        )

    user = User(
        username=user_in.username,
        email=user_in.email,
        full_name=user_in.full_name,
        password_hash=get_password_hash(user_in.password),
        role=UserRole.USER.value,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ----- Login / refresh / logout -----

@router.post("/login", response_model=Token)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    username = form_data.username.strip()
    password = form_data.password

    if not username or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username et mot de passe sont obligatoires.",
        )

    if not (3 <= len(username) <= 32):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Le nom d'utilisateur doit contenir entre 3 et 32 caractères.",
        )
    if not (8 <= len(password) <= 72):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Le mot de passe doit contenir entre 8 et 72 caractères.",
        )

    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identifiants invalides.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Compte utilisateur désactivé.",
        )

    access_token_expires = timedelta(
        minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES
    )
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role},
        expires_delta=access_token_expires,
    )

    refresh_token = create_refresh_token_for_user(db, user)

    user.last_login_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()

    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
    )


@router.post("/refresh", response_model=Token)
def refresh_access_token(
    body: RefreshTokenRequest,
    db: Session = Depends(get_db),
):
    raw_refresh_token = body.refresh_token
    if not raw_refresh_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="refresh_token manquant.",
        )

    stored: RefreshToken | None = get_stored_refresh_token(db, raw_refresh_token)
    if stored is None or stored.revoked:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token invalide.",
        )

    if stored.expires_at < datetime.now(timezone.utc):
        revoke_refresh_token(db, stored)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token expiré.",
        )

    user = stored.user
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Utilisateur invalide ou désactivé.",
        )

    revoke_refresh_token(db, stored)

    access_token_expires = timedelta(
        minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES
    )
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role},
        expires_delta=access_token_expires,
    )

    new_refresh_token = create_refresh_token_for_user(db, user)

    return Token(
        access_token=access_token,
        refresh_token=new_refresh_token,
    )


@router.post("/logout", status_code=204)
def logout(
    body: RefreshTokenRequest,
    db: Session = Depends(get_db),
):
    raw_refresh_token = body.refresh_token
    if not raw_refresh_token:
        return

    stored: RefreshToken | None = get_stored_refresh_token(db, raw_refresh_token)
    if stored is None or stored.revoked:
        return

    revoke_refresh_token(db, stored)
    return


# ----- /me -----

@router.get("/me", response_model=UserRead)
def get_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = (
        db.query(User)
        .options(selectinload(User.ports))
        .filter(User.id == current_user.id)
        .first()
    )
    return user


# ----- ADMIN / SUPER_ADMIN : gestion users -----

@router.post("/users", response_model=UserRead, status_code=201)
def create_user_admin(
    user_in: AdminUserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Création de user par ADMIN / SUPER_ADMIN.
    - SUPER_ADMIN peut créer SUPER_ADMIN / ADMIN / USER.
    - ADMIN ne peut créer que des USER.
    - Ports:
        * USER => au moins 1 port obligatoire
        * ADMIN/SUPER_ADMIN => ports optionnels
    """
    if current_user.role == UserRole.ADMIN.value and user_in.role != UserRole.USER:
        raise HTTPException(
            status_code=403,
            detail="Un ADMIN ne peut créer que des USER.",
        )

    existing = db.query(User).filter(User.username == user_in.username).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ce nom d'utilisateur existe déjà.",
        )

    existing_email = db.query(User).filter(User.email == user_in.email).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cet email est déjà utilisé.",
        )

    user = User(
        username=user_in.username,
        email=user_in.email,
        full_name=user_in.full_name,
        password_hash=get_password_hash(user_in.password),
        role=user_in.role.value,
        is_active=True,
    )
    db.add(user)
    db.flush()

    created_ports: list[UserPort] = []
    for p in (user_in.ports or []):
        up = UserPort(
            user_id=user.id,
            label=p.label.strip() if p.label else None,
            value=p.value.strip(),
        )
        db.add(up)
        created_ports.append(up)

    # USER => ports obligatoires
    if user_in.role == UserRole.USER and not created_ports:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Au moins un port est requis pour un utilisateur USER.",
        )

    # Remplir les champs legacy uniquement si on a au moins un port
    if created_ports:
        first_port = created_ports[0]
        user.port_label = first_port.label
        user.port_value = first_port.value
    else:
        user.port_label = None
        user.port_value = None

    db.commit()
    db.refresh(user)
    return user


@router.get("/users", response_model=UserList)
def list_users(
    search: str | None = Query(None, min_length=1, max_length=200),
    role: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Liste tous les users (ADMIN et SUPER_ADMIN).
    Supports server-side search by username, email, full_name
    and optional role filtering.
    """
    q = db.query(User).options(
        selectinload(User.refresh_tokens),
        selectinload(User.ports),
    )

    # --- role filter ---
    if role and role != "ALL":
        q = q.filter(User.role == role)

    # --- server-side search ---
    if search:
        pattern = f"%{search}%"
        q = q.filter(
            or_(
                User.username.ilike(pattern),
                User.email.ilike(pattern),
                User.full_name.ilike(pattern),
            )
        )

    users = q.order_by(User.id.asc()).all()

    admin_reads: list[UserAdminRead] = []
    for u in users:
        admin_reads.append(
            UserAdminRead(
                id=u.id,
                username=u.username,
                email=u.email,
                full_name=u.full_name,
                role=UserRole(u.role),
                is_active=u.is_active,
                port_label=u.port_label,
                port_value=u.port_value,
                password_hash=u.password_hash,
                ports=list(u.ports),
            )
        )

    return UserList(users=admin_reads)


@router.patch("/users/{user_id}", response_model=UserRead)
def update_user_admin(
    user_id: int,
    user_in: AdminUserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = (
        db.query(User)
        .options(selectinload(User.ports))
        .filter(User.id == user_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé.")

    # ADMIN ne peut modifier que des USER
    if current_user.role == UserRole.ADMIN.value and user.role != UserRole.USER.value:
        raise HTTPException(status_code=403, detail="Un ADMIN ne peut modifier que des USER.")

    # Si on tente de modifier role => SUPER_ADMIN only
    if user_in.role is not None and current_user.role != UserRole.SUPER_ADMIN.value:
        raise HTTPException(status_code=403, detail="Seul un SUPER_ADMIN peut changer les rôles.")

    # Protéger SUPER_ADMIN contre modifications par non superadmin
    if user.role == UserRole.SUPER_ADMIN.value and current_user.role != UserRole.SUPER_ADMIN.value:
        raise HTTPException(status_code=403, detail="Impossible de modifier un SUPER_ADMIN.")

    # Interdire de changer ton propre rôle
    if user_in.role is not None and user.id == current_user.id and user_in.role.value != user.role:
        raise HTTPException(status_code=403, detail="Vous ne pouvez pas modifier votre propre rôle.")

    # Interdire de changer le rôle d'un SUPER_ADMIN (même par SUPER_ADMIN)
    if user_in.role is not None and user.role == UserRole.SUPER_ADMIN.value:
        raise HTTPException(status_code=403, detail="Impossible de modifier le rôle d'un SUPER_ADMIN.")

    # --- role ---
    if user_in.role is not None:
        user.role = user_in.role.value

    # --- email ---
    if user_in.email is not None:
        existing_email = (
            db.query(User)
            .filter(User.email == user_in.email, User.id != user.id)
            .first()
        )
        if existing_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cet email est déjà utilisé.",
            )
        user.email = str(user_in.email)

    # --- full_name ---
    if user_in.full_name is not None:
        user.full_name = user_in.full_name

    # --- password ---
    if user_in.password is not None:
        user.password_hash = get_password_hash(user_in.password)

    # --- is_active ---
    if user_in.is_active is not None:
        user.is_active = user_in.is_active

    # --- ports (si fourni => remplace tous les ports) ---
    if user_in.ports is not None:
        # IMPORTANT: utiliser l'ORM (delete-orphan) au lieu de bulk delete
        user.ports.clear()
        db.flush()

        created_ports: list[UserPort] = []
        for p in user_in.ports:
            up = UserPort(
                label=p.label.strip() if p.label else None,
                value=p.value.strip(),
            )
            user.ports.append(up)   # via relation ORM
            created_ports.append(up)

        if not created_ports:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Au moins un port valide est requis.",
            )

        first_port = created_ports[0]
        user.port_label = first_port.label
        user.port_value = first_port.value

    db.commit()
    db.refresh(user)
    return user



@router.delete("/users/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Suppression d'un user.
    - Nobody can delete a SUPER_ADMIN.
    - ADMIN : ne peut supprimer que des USER.
    - SUPER_ADMIN : peut supprimer ADMIN et USER, mais not other SUPER_ADMIN.
    - Nobody can delete themselves.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé.")

    # Cannot delete yourself
    if user.id == current_user.id:
        raise HTTPException(
            status_code=400,
            detail="Vous ne pouvez pas supprimer votre propre compte.",
        )

    # Nobody can delete a SUPER_ADMIN
    if user.role == UserRole.SUPER_ADMIN.value:
        raise HTTPException(
            status_code=403,
            detail="Les utilisateurs SUPER_ADMIN ne peuvent pas être supprimés.",
        )

    # ADMIN can only delete USER
    if current_user.role == UserRole.ADMIN.value:
        if user.role != UserRole.USER.value:
            raise HTTPException(
                status_code=403,
                detail="Un ADMIN ne peut supprimer que des USER.",
            )

    db.delete(user)
    db.commit()
    return
